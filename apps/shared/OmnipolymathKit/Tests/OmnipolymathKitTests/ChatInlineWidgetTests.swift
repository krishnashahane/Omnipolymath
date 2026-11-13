import Foundation
import OmnipolymathKit
import Testing
@testable import OmnipolymathChatUI

#if os(macOS) && canImport(WebKit)
import AppKit
import WebKit
#endif

struct ChatInlineWidgetTests {
    @Test func `sanitizes widget export filenames`() {
        #expect(ChatInlineWidgetExport.filename(title: "  Sales / Q3\\Summary\u{0007}  ") ==
            "Sales  Q3Summary.png")
        #expect(ChatInlineWidgetExport.filename(title: "\n\t") == "widget.png")
        #expect(ChatInlineWidgetExport.filename(title: nil) == "widget.png")
    }

    @Test func `decodes projected canvas widget block`() throws {
        let data = Data(#"""
        {
          "role": "assistant",
          "content": [
            {"type": "text", "text": "Done"},
            {
              "type": "canvas",
              "preview": {
                "kind": "canvas",
                "surface": "assistant_message",
                "render": "url",
                "title": "Status",
                "preferredHeight": 240,
                "url": "/__omnipolymath__/canvas/documents/widget-1/index.html",
                "sandbox": "scripts"
              }
            }
          ]
        }
        """#.utf8)

        let message = try JSONDecoder().decode(OmnipolymathChatMessage.self, from: data)
        let preview = try #require(message.content.last?.preview)
        #expect(preview.inlineWidgetPath == "/__omnipolymath__/canvas/documents/widget-1/index.html")
        #expect(preview.inlineWidgetHeight == 240)

        let unsafe = OmnipolymathChatCanvasPreview(
            kind: "canvas",
            surface: "assistant_message",
            render: "url",
            title: nil,
            preferredHeight: nil,
            url: "https://attacker.example/widget.html",
            viewId: nil,
            sandbox: "scripts")
        #expect(unsafe.inlineWidgetPath == nil)
    }

    @Test func `resolves only capability scoped widget documents`() {
        let surface = "https://gateway.example/__omnipolymath__/cap/token"
        let target = "/__omnipolymath__/canvas/documents/widget-1/index.html"

        #expect(OmnipolymathChatWidgetURLResolver.resolve(
            surfaceURL: surface,
            target: target)?.absoluteString ==
            "https://gateway.example/__omnipolymath__/cap/token/__omnipolymath__/canvas/documents/widget-1/index.html")
        #expect(OmnipolymathChatWidgetURLResolver.resolve(surfaceURL: "https://gateway.example", target: target) == nil)
        #expect(OmnipolymathChatWidgetURLResolver.resolve(
            surfaceURL: surface,
            target: "https://attacker.example/widget.html") == nil)
        #expect(OmnipolymathChatWidgetURLResolver.resolve(
            surfaceURL: surface,
            target: "/__omnipolymath__/a2ui/index.html") == nil)
        #expect(OmnipolymathChatWidgetURLResolver.resolve(
            surfaceURL: surface,
            target: "/__omnipolymath__/canvas/documents/%252e%252e/index.html") == nil)
        #expect(OmnipolymathChatWidgetURLResolver.resolve(
            surfaceURL: surface,
            target: "/__omnipolymath__/canvas/documents/%2525252525252525252525252525252525/index.html") == nil)
    }

    @Test func `resource equality ignores internal recovery metadata`() throws {
        let url = try #require(URL(string: "https://gateway.example/widget"))
        let publicResource = OmnipolymathChatWidgetResource(url: url)
        let trackedResource = OmnipolymathChatWidgetResource(
            url: url,
            tlsFingerprintSHA256: nil,
            surfaceRole: .node,
            attemptedSurfaceRoles: [.node])

        #expect(publicResource == trackedResource)
    }

    @Test func `uses replacement route after capability refresh loses its lease`() async throws {
        let target = "/__omnipolymath__/canvas/documents/widget-1/index.html"
        let oldSurface = "https://gateway.example/__omnipolymath__/cap/old"
        let newSurface = "https://gateway.example/__omnipolymath__/cap/new"
        let failedURL = try #require(OmnipolymathChatWidgetURLResolver.resolve(
            surfaceURL: oldSurface,
            target: target))
        let failedResource = OmnipolymathChatWidgetResource(url: failedURL)
        let probe = ChatWidgetRouteReconnectProbe(
            route: GatewayCanvasHostRoute(url: oldSurface, tlsFingerprintSHA256: nil),
            replacement: GatewayCanvasHostRoute(url: newSurface, tlsFingerprintSHA256: nil))

        let resolved = await OmnipolymathChatWidgetURLResolver.resolveResource(
            target: target,
            replacing: failedResource,
            currentSurfaceRoutes: { await probe.current() },
            refreshNodeSurfaceRoute: { observed in await probe.reconnect(observed: observed) },
            refreshOperatorSurfaceRoute: { _ in nil })

        #expect(resolved?.url == OmnipolymathChatWidgetURLResolver.resolve(surfaceURL: newSurface, target: target))
        #expect(await probe.refreshCount == 1)
    }

    @Test func `accepts a same URL widget route when it acquires a TLS pin`() async throws {
        let target = "/__omnipolymath__/canvas/documents/widget-1/index.html"
        let surface = "https://gateway.example/__omnipolymath__/cap/token"
        let newPin = String(repeating: "bb", count: 32)
        let failedURL = try #require(OmnipolymathChatWidgetURLResolver.resolve(
            surfaceURL: surface,
            target: target))
        let probe = ChatWidgetRouteReconnectProbe(
            route: GatewayCanvasHostRoute(url: surface, tlsFingerprintSHA256: nil),
            replacement: GatewayCanvasHostRoute(url: surface, tlsFingerprintSHA256: newPin))
        let initialResource = await OmnipolymathChatWidgetURLResolver.resolveResource(
            target: target,
            replacing: nil,
            currentSurfaceRoutes: { await probe.current() },
            refreshNodeSurfaceRoute: { _ in nil },
            refreshOperatorSurfaceRoute: { _ in nil })

        let resolved = await OmnipolymathChatWidgetURLResolver.resolveResource(
            target: target,
            replacing: initialResource,
            currentSurfaceRoutes: { await probe.current() },
            refreshNodeSurfaceRoute: { observed in await probe.reconnect(observed: observed) },
            refreshOperatorSurfaceRoute: { _ in nil })

        #expect(resolved?.url == failedURL)
        #expect(resolved?.tlsFingerprintSHA256 == newPin)
        #expect(await probe.refreshCount == 1)
    }

    @Test func `refreshes node once before trying the operator fallback`() async {
        let target = "/__omnipolymath__/canvas/documents/widget-1/index.html"
        let oldSurface = "https://gateway.example/__omnipolymath__/cap/old"
        let newSurface = "https://gateway.example/__omnipolymath__/cap/new"
        let fallbackSurface = "https://operator.example/__omnipolymath__/cap/fallback"
        let probe = ChatWidgetRouteReconnectProbe(
            route: GatewayCanvasHostRoute(url: oldSurface, tlsFingerprintSHA256: nil),
            replacement: GatewayCanvasHostRoute(url: newSurface, tlsFingerprintSHA256: nil),
            operatorRoute: GatewayCanvasHostRoute(url: fallbackSurface, tlsFingerprintSHA256: nil))
        let initialNode = await OmnipolymathChatWidgetURLResolver.resolveResource(
            target: target,
            replacing: nil,
            currentSurfaceRoutes: { await probe.current() },
            refreshNodeSurfaceRoute: { _ in nil },
            refreshOperatorSurfaceRoute: { _ in nil })

        let refreshedNode = await OmnipolymathChatWidgetURLResolver.resolveResource(
            target: target,
            replacing: initialNode,
            currentSurfaceRoutes: { await probe.current() },
            refreshNodeSurfaceRoute: { observed in await probe.reconnect(observed: observed) },
            refreshOperatorSurfaceRoute: { _ in nil })

        #expect(refreshedNode?.url == OmnipolymathChatWidgetURLResolver.resolve(surfaceURL: newSurface, target: target))

        let fallback = await OmnipolymathChatWidgetURLResolver.resolveResource(
            target: target,
            replacing: refreshedNode,
            currentSurfaceRoutes: { await probe.current() },
            refreshNodeSurfaceRoute: { observed in await probe.reconnect(observed: observed) },
            refreshOperatorSurfaceRoute: { _ in nil })

        #expect(fallback?.url == OmnipolymathChatWidgetURLResolver.resolve(
            surfaceURL: fallbackSurface,
            target: target))
        #expect(await probe.refreshCount == 1)
    }

    @Test func `refreshes the operator capability when the node route is unavailable`() async throws {
        let target = "/__omnipolymath__/canvas/documents/widget-1/index.html"
        let oldSurface = "https://operator.example/__omnipolymath__/cap/old"
        let newSurface = "https://operator.example/__omnipolymath__/cap/new"
        let failedURL = try #require(OmnipolymathChatWidgetURLResolver.resolve(
            surfaceURL: oldSurface,
            target: target))
        let failedResource = OmnipolymathChatWidgetResource(url: failedURL)
        let probe = ChatWidgetOperatorRouteRefreshProbe(
            route: GatewayCanvasHostRoute(url: oldSurface, tlsFingerprintSHA256: nil),
            replacement: GatewayCanvasHostRoute(url: newSurface, tlsFingerprintSHA256: nil))

        let resolved = await OmnipolymathChatWidgetURLResolver.resolveResource(
            target: target,
            replacing: failedResource,
            currentSurfaceRoutes: { await probe.current() },
            refreshNodeSurfaceRoute: { _ in nil },
            refreshOperatorSurfaceRoute: { observed in await probe.refresh(observed: observed) })

        #expect(resolved?.url == OmnipolymathChatWidgetURLResolver.resolve(surfaceURL: newSurface, target: target))
        #expect(await probe.refreshCount == 1)
    }

    @Test func `rejects a TLS pin on a cleartext widget route`() async {
        let target = "/__omnipolymath__/canvas/documents/widget-1/index.html"
        let route = GatewayCanvasHostRoute(
            url: "http://gateway.example/__omnipolymath__/cap/token",
            tlsFingerprintSHA256: String(repeating: "aa", count: 32))

        let resolved = await OmnipolymathChatWidgetURLResolver.resolveResource(
            target: target,
            replacing: nil,
            currentSurfaceRoutes: { (node: route, operatorSurface: nil) },
            refreshNodeSurfaceRoute: { _ in nil },
            refreshOperatorSurfaceRoute: { _ in nil })

        #expect(resolved == nil)
    }

    #if canImport(WebKit) && (os(iOS) || os(macOS))
    #if os(macOS)
    @Test @MainActor func `invalidated widget snapshots cannot publish a late completion`() throws {
        let fixture = try ChatInlineWidgetSnapshotFixture()
        fixture.capture(fixture.request())

        fixture.owner.invalidate()
        try fixture.complete()

        #expect(fixture.outcomes.isEmpty)
    }

    @Test @MainActor func `widget snapshots reject a changed document or generation before capture`() throws {
        let fixture = try ChatInlineWidgetSnapshotFixture()
        let replacement = try OmnipolymathChatWidgetResource(
            url: #require(URL(string: "https://gateway.example/replacement")))
        let changedPin = OmnipolymathChatWidgetResource(
            url: fixture.resource.url,
            tlsFingerprintSHA256: String(repeating: "ab", count: 32))

        fixture.capture(fixture.request(), resource: replacement)
        fixture.capture(fixture.request(), resource: changedPin)
        fixture.capture(fixture.request(generation: UUID()))

        #expect(fixture.webView.completions.isEmpty)
        #expect(fixture.outcomes.isEmpty)
    }

    @Test @MainActor func `widget snapshot completions cannot outlive document or TLS replacements`() throws {
        let oldURL = try #require(URL(string: "https://gateway.example/old"))
        let newURL = try #require(URL(string: "https://gateway.example/replacement"))
        let replacements = [
            OmnipolymathChatWidgetResource(url: newURL),
            OmnipolymathChatWidgetResource(url: oldURL, tlsFingerprintSHA256: String(repeating: "ab", count: 32)),
        ]

        for replacement in replacements {
            let fixture = try ChatInlineWidgetSnapshotFixture()
            fixture.capture(fixture.request())
            fixture.capture(nil, resource: replacement)

            try fixture.complete()

            #expect(fixture.outcomes.isEmpty)
        }
    }

    @Test @MainActor func `widget snapshot completions cannot outlive a reset generation`() throws {
        let fixture = try ChatInlineWidgetSnapshotFixture()
        fixture.capture(fixture.request())
        fixture.capture(nil, generation: UUID())

        try fixture.complete()

        #expect(fixture.outcomes.isEmpty)
    }

    @Test @MainActor func `widget snapshot completions cannot migrate to a replacement WebView`() throws {
        let fixture = try ChatInlineWidgetSnapshotFixture()
        let replacement = ChatInlineWidgetDeferredSnapshotWebView(
            frame: .zero,
            configuration: WKWebViewConfiguration())
        fixture.capture(fixture.request())
        fixture.capture(nil, from: replacement)

        try fixture.complete()

        #expect(fixture.outcomes.isEmpty)
    }

    @Test @MainActor func `newer widget snapshots supersede older asynchronous completions`() throws {
        let fixture = try ChatInlineWidgetSnapshotFixture()
        let first = fixture.request(action: .copy)
        let second = fixture.request(action: .save)
        fixture.capture(first)
        fixture.capture(second)

        try fixture.complete(at: 0)
        #expect(fixture.outcomes.isEmpty)

        try fixture.complete(at: 1)
        guard case let .success(request, _) = try #require(fixture.outcomes.first) else {
            Issue.record("The current widget snapshot did not produce an image")
            return
        }
        #expect(request == second)
    }

    @Test @MainActor func `current widget snapshots publish one image for the exact document`() throws {
        let fixture = try ChatInlineWidgetSnapshotFixture()
        let request = fixture.request()
        fixture.capture(request)
        fixture.capture(request)

        #expect(fixture.webView.completions.count == 1)
        try fixture.complete()

        guard case let .success(completed, _) = try #require(fixture.outcomes.first) else {
            Issue.record("The current widget snapshot did not produce an image")
            return
        }
        #expect(completed == request)
        #expect(fixture.outcomes.count == 1)
    }
    #endif

    @Test func `bounds WebKit content process recovery per document`() {
        var recovery = ChatInlineWidgetContentProcessRecovery()

        #expect(recovery.nextAction() == .reload)
        #expect(recovery.nextAction() == .fail)
        #expect(recovery.nextAction() == .fail)

        recovery.reset()
        #expect(recovery.nextAction() == .reload)
    }

    @Test func `normalizes exact SHA-256 widget certificate pins`() {
        let fingerprint = String(repeating: "aB", count: 32)
        #expect(ChatInlineWidgetTLSPin.normalize("SHA-256: \(fingerprint)") == fingerprint.lowercased())
        #expect(ChatInlineWidgetTLSPin.normalize("abc") == nil)
        #expect(ChatInlineWidgetTLSPin.fingerprint(certificateData: Data("abc".utf8)) ==
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")
    }

    @Test func `requires enforcing response CSP before delegating widget resources`() {
        #expect(ChatInlineWidgetResourcePolicy.allowsStaticResources(
            contentSecurityPolicy: "default-src 'none'; script-src 'unsafe-inline' https://cdn.jsdelivr.net; sandbox allow-scripts"))
        #expect(ChatInlineWidgetResourcePolicy.allowsStaticResources(
            contentSecurityPolicy: " SANDBOX\tallow-scripts ; DEFAULT-SRC 'none' "))
        let legacyOrUnrestrictedPolicies: [String?] = [
            nil,
            "",
            "sandbox allow-scripts",
            "default-src 'none'",
            "default-src *; sandbox allow-scripts",
            "default-src 'none'; sandbox allow-scripts allow-same-origin",
            "default-src *; default-src 'none'; sandbox allow-scripts",
        ]
        for policy in legacyOrUnrestrictedPolicies {
            #expect(!ChatInlineWidgetResourcePolicy.allowsStaticResources(contentSecurityPolicy: policy))
        }
    }
    #endif
}

#if os(macOS) && canImport(WebKit)
@MainActor
private final class ChatInlineWidgetSnapshotFixture {
    let resource: OmnipolymathChatWidgetResource
    let generation = UUID()
    let webView = ChatInlineWidgetDeferredSnapshotWebView(
        frame: .zero,
        configuration: WKWebViewConfiguration())
    let owner = ChatInlineWidgetSnapshotCapture()
    var outcomes: [ChatInlineWidgetSnapshotOutcome] = []

    init() throws {
        self.resource = try OmnipolymathChatWidgetResource(
            url: #require(URL(string: "https://gateway.example/old")))
    }

    func request(
        action: ChatInlineWidgetSnapshotRequest.Action = .copy,
        generation: UUID? = nil,
        resource: OmnipolymathChatWidgetResource? = nil) -> ChatInlineWidgetSnapshotRequest
    {
        ChatInlineWidgetSnapshotRequest(
            action: action,
            generation: generation ?? self.generation,
            resource: resource ?? self.resource)
    }

    func capture(
        _ request: ChatInlineWidgetSnapshotRequest?,
        from webView: WKWebView? = nil,
        generation: UUID? = nil,
        resource: OmnipolymathChatWidgetResource? = nil)
    {
        self.owner.capture(
            request,
            from: webView ?? self.webView,
            generation: generation ?? self.generation,
            resource: resource ?? self.resource)
        { [weak self] outcome in
            self?.outcomes.append(outcome)
        }
    }

    func complete(at index: Int = 0) throws {
        let completion = try #require(self.webView.completions.indices.contains(index)
            ? self.webView.completions[index]
            : nil)
        completion(NSImage(size: NSSize(width: 1, height: 1)), nil)
    }
}

@MainActor
private final class ChatInlineWidgetDeferredSnapshotWebView: WKWebView {
    var completions: [@MainActor (NSImage?, (any Error)?) -> Void] = []

    override func takeSnapshot(
        with _: WKSnapshotConfiguration?,
        completionHandler: @escaping @MainActor (NSImage?, (any Error)?) -> Void)
    {
        self.completions.append(completionHandler)
    }
}
#endif

private actor ChatWidgetOperatorRouteRefreshProbe {
    private var route: GatewayCanvasHostRoute
    private let replacement: GatewayCanvasHostRoute
    private(set) var refreshCount = 0

    init(route: GatewayCanvasHostRoute, replacement: GatewayCanvasHostRoute) {
        self.route = route
        self.replacement = replacement
    }

    func current() -> (node: GatewayCanvasHostRoute?, operatorSurface: GatewayCanvasHostRoute?) {
        (node: nil, operatorSurface: self.route)
    }

    func refresh(observed _: GatewayCanvasHostRoute?) -> GatewayCanvasHostRoute? {
        self.refreshCount += 1
        self.route = self.replacement
        return self.replacement
    }
}

private actor ChatWidgetRouteReconnectProbe {
    private var route: GatewayCanvasHostRoute?
    private let replacement: GatewayCanvasHostRoute
    private let operatorRoute: GatewayCanvasHostRoute?
    private(set) var refreshCount = 0

    init(
        route: GatewayCanvasHostRoute,
        replacement: GatewayCanvasHostRoute,
        operatorRoute: GatewayCanvasHostRoute? = nil)
    {
        self.route = route
        self.replacement = replacement
        self.operatorRoute = operatorRoute
    }

    func current() -> (node: GatewayCanvasHostRoute?, operatorSurface: GatewayCanvasHostRoute?) {
        (node: self.route, operatorSurface: self.operatorRoute)
    }

    func reconnect(observed _: GatewayCanvasHostRoute?) -> GatewayCanvasHostRoute? {
        self.refreshCount += 1
        self.route = self.replacement
        return nil
    }
}
