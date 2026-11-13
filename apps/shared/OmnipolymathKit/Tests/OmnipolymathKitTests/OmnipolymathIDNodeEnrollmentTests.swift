import CryptoKit
import Foundation
import OmnipolymathNativeState
import Synchronization
import Testing
@testable import OmnipolymathKit

struct OmnipolymathIDNodeEnrollmentTests {
    private struct Fixture: Decodable {
        struct Invite: Decodable { let link: String
            let verification_code: String
        }

        struct Key: Decodable { let seed_hex: String
            let iroh: String
        }

        let now: Int64
        let node_invite: Invite
        let node_key: Key
        let reset_invite_link: String
    }

    private func fixture() throws -> (Fixture, [String: OmnipolymathIDCanonicalJSON]) {
        let url = try #require(Bundle.module.url(
            forResource: "OmnipolymathIDNodeEnrollment",
            withExtension: "json",
            subdirectory: "Fixtures"))
        let data = try Data(contentsOf: url)
        let value = try OmnipolymathIDCanonicalJSON.parse(data)
        guard case let .object(fields) = value else { throw OmnipolymathIDNodeEnrollmentError.malformed }
        return try (JSONDecoder().decode(Fixture.self, from: data), fields)
    }

    private func description() throws -> OmnipolymathIDNodeEnrollmentDescription {
        try .init(displayName: "Build node", platform: "linux", commands: ["system.run"], caps: ["system"])
    }

    @Test func `signed golden redemption and comparison code`() throws {
        let (fixture, json) = try fixture()
        var link = try OmnipolymathIDNodeEnrollmentLink(fixture.node_invite.link)
        let identity = try OmnipolymathIDNodeIdentity(seed: OmnipolymathIDNodeIdentity.unhex(fixture.node_key.seed_hex))
        let description = try description()
        #expect(identity.peerKey == fixture.node_key.iroh)
        #expect(OmnipolymathIDNodeEnrollmentClient.verificationCode(
            link: link,
            peerKey: identity.peerKey,
            description: description) == "168017")
        let redemption = try OmnipolymathIDNodeEnrollmentClient.redemption(
            link: &link,
            identity: identity,
            description: description,
            now: fixture.now)
        let envelopeFields: Set = ["v", "type", "body", "signer", "alg", "sig"]
        var actual = try redemption.fields(envelopeFields)
        var expected = try #require(json["redemption"]).fields(envelopeFields)
        let actualSignature = try #require(actual["sig"]).text()
        let expectedSignature = try #require(expected["sig"]).text()
        actual["sig"] = nil
        expected["sig"] = nil
        #expect(actual == expected)
        let publicKey = try Curve25519.Signing.PublicKey(rawRepresentation:
            OmnipolymathIDNodeIdentity.unhex(fixture.node_key.iroh, prefix: "iroh:"))
        let input = try Data("omnipolymath/NodeRedemption/v1\0".utf8) + #require(expected["body"]).encoded
        // CryptoKit may randomize Ed25519 signatures. Compare every signed field exactly,
        // then verify both signatures over the golden input instead of requiring equal bytes.
        for signature in [actualSignature, expectedSignature] {
            #expect(try publicKey.isValidSignature(
                OmnipolymathIDNodeIdentity.decodeBase64URL(signature, count: 64),
                for: input))
        }
        let path = "/v1/claws/\(link.clawID)/node/descriptor"
        let header = try OmnipolymathIDNodeEnrollmentClient.discoverySignature(
            identity: identity,
            method: "GET",
            path: path,
            body: Data(),
            now: fixture.now)
        let expectedHeader = try #require(json["discovery_get_signature"]).text()
        let prefix = "keyid=\(identity.signingKey),ts=\(fixture.now),sig="
        let requestInput = Data("omnipolymath/discovery-request/v1\0".utf8) + OmnipolymathIDCanonicalJSON.object([
            "body_sha256": .string("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"),
            "method": .string("GET"), "path": .string(path), "ts": .integer(fixture.now),
        ]).encoded
        for signedHeader in [header, expectedHeader] {
            #expect(signedHeader.hasPrefix(prefix))
            let signature = try OmnipolymathIDNodeIdentity.decodeBase64URL(
                String(signedHeader.dropFirst(prefix.count)),
                count: 64)
            #expect(publicKey.isValidSignature(signature, for: requestInput))
        }
    }

    @Test func `strict link origin and manifest`() throws {
        let (fixture, _) = try fixture()
        for suffix in ["&unknown=x", "&c=0123456789abcdef0123456789abcdef", "&", "#x"] {
            #expect(throws: (any Error).self) { try OmnipolymathIDNodeEnrollmentLink(fixture.node_invite.link + suffix) }
        }
        for prefix in ["omnipolymath-node://join/", "omnipolymath-node://user@join", "omnipolymath-node://join?x=1"] {
            let bad = fixture.node_invite.link.replacingOccurrences(of: "omnipolymath-node://join", with: prefix)
            #expect(throws: (any Error).self) { try OmnipolymathIDNodeEnrollmentLink(bad) }
        }
        for origin in [
            "",
            "http://discovery.example",
            "https://discovery.example/path",
            "https://u@discovery.example",
            "https://discovery.example/?x",
        ] {
            #expect(throws: (any Error).self) { try OmnipolymathIDNodeEnrollmentLink.discoveryOrigin(origin) }
        }
        #expect(try OmnipolymathIDNodeEnrollmentLink.discoveryOrigin("https://discovery.example")
            .host == "discovery.example")
        #expect(throws: (any Error).self) { try OmnipolymathIDNodeEnrollmentDescription(
            displayName: "bad\nname",
            platform: "ios",
            commands: [],
            caps: []) }
        #expect(throws: (any Error).self) { try OmnipolymathIDNodeEnrollmentDescription(
            displayName: "name",
            platform: "ios",
            commands: ["x", "x"],
            caps: []) }
    }

    @Test func `canonical JSON refuses ambiguous or unrepresentable values`() throws {
        for bad in [
            "{\"a\":1,\"a\":2}",
            "\"\\ud800\"",
            "01",
            "1.5",
            "-9223372036854775808",
            "9007199254740992",
            "{\"x\":true,}",
        ] {
            #expect(throws: (any Error).self) { try OmnipolymathIDCanonicalJSON.parse(Data(bad.utf8)) }
        }
        #expect(throws: OmnipolymathIDNodeEnrollmentError.malformed) {
            try OmnipolymathIDCanonicalJSON.parse(Data([0x22, 0x5C, 0x75, 0xEF, 0xBB, 0xBF, 0x61, 0x22]))
        }
        let json = try OmnipolymathIDCanonicalJSON.parse(Data("{\"z\":1,\"a\":\"\\u000f/\\n😀\"}".utf8))
        #expect(json.canonical == "{\"a\":\"\\u000f/\\n😀\",\"z\":1}")
        let ordering = OmnipolymathIDCanonicalJSON.object(["\u{E000}": .integer(1), "😀": .integer(2)])
        #expect(ordering.canonical == "{\"😀\":2,\"\u{E000}\":1}")
    }

    @Test func `verified descriptor rejects rollback staleness and unknown signed fields`() throws {
        let (fixture, json) = try fixture()
        let link = try OmnipolymathIDNodeEnrollmentLink(fixture.node_invite.link)
        let origin = try OmnipolymathIDNodeEnrollmentLink.discoveryOrigin("https://discovery.example")
        let response = try #require(json["response"])
        let verify: (Data, OmnipolymathIDNodeTrustState?, Int64) throws
            -> OmnipolymathIDNodeTrustTarget = { data, previous, now in
                try OmnipolymathIDNodeTrust.assess(
                    response: data,
                    link: link,
                    discoveryOrigin: origin,
                    peerKey: fixture.node_key.iroh,
                    previous: previous,
                    now: now).verdict.get()
            }
        let target = try verify(response.encoded, nil, fixture.now)
        #expect(target.state.bindingSequence == 1)
        #expect(target.serverKey.hasPrefix("iroh:"))
        #expect(throws: OmnipolymathIDNodeEnrollmentError.staleSnapshot) { try verify(
            response.encoded,
            nil,
            fixture.now + 10800) }
        #expect(throws: OmnipolymathIDNodeEnrollmentError.staleSnapshot) { try verify(
            response.encoded,
            nil,
            fixture.now - 4000) }
        let advanced = OmnipolymathIDNodeTrustState(
            clawID: link.clawID,
            rootFingerprint: link.rootFingerprint,
            bindingSequence: 2,
            snapshotSequence: 2,
            snapshotIssuedAt: fixture.now,
            snapshotBindingSequence: 2)
        #expect(throws: OmnipolymathIDNodeEnrollmentError.rollback) { try verify(response.encoded, advanced, fixture.now) }
        // Unknown fields must fail even if their signature is valid under the synthetic fixture K_gw.
        var outer = try response.fields(["descriptor", "snapshot"])
        var snapshot = try #require(outer["snapshot"]).fields(["v", "type", "body", "signer", "alg", "sig"])
        guard case var .object(body) = try #require(snapshot["body"])
        else { throw OmnipolymathIDNodeEnrollmentError.malformed }
        body["unknown"] = .bool(true)
        snapshot["body"] = .object(body)
        let gateway = try Curve25519.Signing.PrivateKey(rawRepresentation:
            OmnipolymathIDNodeIdentity.unhex(#require(json["gateway_seed_hex"]).text()))
        let signature = try gateway.signature(for: Data("omnipolymath/MembershipSnapshot/v1\0".utf8) +
            OmnipolymathIDCanonicalJSON.object(body).encoded)
        snapshot["sig"] = .string(OmnipolymathIDNodeIdentity.base64URL(signature))
        outer["snapshot"] = .object(snapshot)
        #expect(throws: OmnipolymathIDNodeEnrollmentError.malformed) { try verify(
            OmnipolymathIDCanonicalJSON.object(outer).encoded,
            nil,
            fixture.now) }
    }

    @Test func `production enrollment sends one mail and commits only verified admission`() async throws {
        let (fixture, json) = try fixture()
        let identity = try OmnipolymathIDNodeIdentity(seed: OmnipolymathIDNodeIdentity.unhex(fixture.node_key.seed_hex))
        let transport = try ScriptedHTTP(responses: [
            .init(status: 202, body: Data("{}".utf8)),
            .init(status: 403, body: Data("{\"error\":{\"retry_after\":2}}".utf8)),
            .init(status: 200, body: #require(json["response"]).encoded),
        ])
        let store = TrustStore()
        let codes = Codes()
        let client = OmnipolymathIDNodeEnrollmentClient(
            http: transport,
            trustStore: store,
            now: { fixture.now },
            sleep: { _ in })
        let target = try await client.enroll(
            joinLink: fixture.node_invite.link,
            discoveryOrigin: "https://discovery.example",
            identity: identity,
            description: self.description(),
            onVerificationCode: { await codes.append($0) })
        #expect(await codes.values == ["168017"])
        #expect(await store.saved?.state == target.state)
        let requests = await transport.requests
        #expect(requests.map(\.httpMethod) == ["POST", "GET", "GET"])
        #expect(requests
            .allSatisfy { $0.url?.host == "discovery.example" && $0.value(forHTTPHeaderField: "authorization") == nil })
        let mail = try #require(requests.first?.httpBody)
        #expect(try #require(String(bytes: mail, encoding: .utf8)).contains("KioqKioq") == false)
        let signed = try #require(requests.first?.value(forHTTPHeaderField: "omnipolymath-signature"))
        #expect(signed.hasPrefix("keyid=\(identity.signingKey),ts=\(fixture.now),sig="))
    }

    @Test func `reset descriptor enrolls new root invitation but never changes an old pin`() async throws {
        let (fixture, json) = try fixture()
        let response = try #require(json["reset_response"]).encoded
        let oldLink = try OmnipolymathIDNodeEnrollmentLink(fixture.node_invite.link)
        let newLink = try OmnipolymathIDNodeEnrollmentLink(fixture.reset_invite_link)
        let origin = try OmnipolymathIDNodeEnrollmentLink.discoveryOrigin("https://discovery.example")
        let identity = try OmnipolymathIDNodeIdentity(seed: OmnipolymathIDNodeIdentity.unhex(fixture.node_key.seed_hex))
        let store = TrustStore()
        let http = ScriptedHTTP(responses: [.init(status: 202, body: Data()), .init(status: 200, body: response)])
        let client = OmnipolymathIDNodeEnrollmentClient(http: http, trustStore: store, now: { fixture.now })
        // The descriptor's binding and reset evidence come from the protocol's owner-reset golden.
        let target = try await client.enroll(
            joinLink: fixture.reset_invite_link,
            discoveryOrigin: origin.absoluteString,
            identity: identity,
            description: self.description(),
            onVerificationCode: { _ in })
        #expect(target.state.rootFingerprint == newLink.rootFingerprint)
        #expect(target.state.bindingSequence == 3)
        #expect(target.state.snapshotBindingSequence == 3)
        #expect(await store.saved?.state == target.state)
        #expect(await http.requests.map(\.httpMethod) == ["POST", "GET"])

        let oldTarget = try OmnipolymathIDNodeTrust.assess(
            response: #require(json["response"]).encoded,
            link: oldLink,
            discoveryOrigin: origin,
            peerKey: identity.peerKey,
            previous: nil,
            now: fixture.now).verdict.get()
        // Neither an old invitation nor a new invitation over an existing pin can repin it.
        let oldPins: [(OmnipolymathIDNodeEnrollmentLink, OmnipolymathIDNodeTrustState?)] = [
            (oldLink, nil),
            (newLink, oldTarget.state),
        ]
        for (link, previous) in oldPins {
            #expect(throws: OmnipolymathIDNodeEnrollmentError.rootMismatch) {
                try OmnipolymathIDNodeTrust.assess(
                    response: response,
                    link: link,
                    discoveryOrigin: origin,
                    peerKey: identity.peerKey,
                    previous: previous,
                    now: fixture.now)
            }
        }
        #expect(throws: OmnipolymathIDNodeEnrollmentError.rootMismatch) {
            try OmnipolymathIDNodeTrust.assessRefresh(
                response: response,
                hostname: oldLink.hostname,
                discoveryOrigin: origin,
                peerKey: identity.peerKey,
                previous: oldTarget.state,
                now: fixture.now)
        }
    }

    @Test func `reset metadata remains strict and cannot replace binding or snapshot signatures`() throws {
        let (fixture, json) = try fixture()
        let response = try #require(json["reset_response"])
        let link = try OmnipolymathIDNodeEnrollmentLink(fixture.reset_invite_link)
        let origin = try OmnipolymathIDNodeEnrollmentLink.discoveryOrigin("https://discovery.example")
        func verify(_ value: OmnipolymathIDCanonicalJSON) throws -> OmnipolymathIDNodeTrustTarget {
            try OmnipolymathIDNodeTrust.assess(
                response: value.encoded,
                link: link,
                discoveryOrigin: origin,
                peerKey: fixture.node_key.iroh,
                previous: nil,
                now: fixture.now).verdict
                .get()
        }
        func replacing(
            _ value: OmnipolymathIDCanonicalJSON,
            path: [String],
            with replacement: OmnipolymathIDCanonicalJSON?) throws
            -> OmnipolymathIDCanonicalJSON
        {
            guard let name = path.first, case var .object(fields) = value else {
                throw OmnipolymathIDNodeEnrollmentError.malformed
            }
            if path.count == 1 {
                fields[name] = replacement
            } else {
                fields[name] = try replacing(#require(fields[name]), path: Array(path.dropFirst()), with: replacement)
            }
            return .object(fields)
        }
        for path in [
            ["descriptor", "unknown"], ["descriptor", "reset", "unknown"],
            ["descriptor", "reset", "previous_binding", "unknown"],
            ["descriptor", "reset", "previous_binding", "body", "unknown"],
            ["descriptor", "reset", "statement", "unknown"],
            ["descriptor", "reset", "statement", "body", "unknown"],
        ] {
            #expect(throws: OmnipolymathIDNodeEnrollmentError.malformed) {
                try verify(replacing(response, path: path, with: .bool(true)))
            }
        }
        let malformedResets: [OmnipolymathIDCanonicalJSON] = [.null, .object([:])]
        for replacement in malformedResets {
            #expect(throws: OmnipolymathIDNodeEnrollmentError.malformed) {
                try verify(replacing(response, path: ["descriptor", "reset"], with: replacement))
            }
        }
        #expect(throws: OmnipolymathIDNodeEnrollmentError.malformed) {
            try verify(replacing(response, path: ["descriptor", "binding"], with: nil))
        }
        for path in [["descriptor", "binding", "body", "issued_at"], ["snapshot", "body", "seq"]] {
            #expect(throws: OmnipolymathIDNodeEnrollmentError.badSignature) {
                try verify(replacing(response, path: path, with: .integer(99)))
            }
        }
        // A fresh pin does not rely on reset signatures, only on its own root's binding and K_gw.
        let untrustedReset = try replacing(
            response,
            path: ["descriptor", "reset", "statement", "sig"],
            with: .string(String(repeating: "A", count: 86)))
        #expect(try verify(untrustedReset).state == verify(response).state)
    }

    @Test func `lost mail response retries identical redemption`() async throws {
        let (fixture, json) = try fixture()
        let identity = try OmnipolymathIDNodeIdentity(seed: OmnipolymathIDNodeIdentity.unhex(fixture.node_key.seed_hex))
        let http = try RetriedMailHTTP(descriptor: #require(json["response"]).encoded)
        let store = TrustStore()
        let delays = RetryDelays()
        let client = OmnipolymathIDNodeEnrollmentClient(
            http: http,
            trustStore: store,
            now: { fixture.now },
            sleep: { await delays.append($0) })
        let target = try await client.enroll(
            joinLink: fixture.node_invite.link,
            discoveryOrigin: "https://discovery.example",
            identity: identity,
            description: self.description(),
            onVerificationCode: { _ in })
        let requests = await http.requests
        #expect(requests.map(\.httpMethod) == ["POST", "POST", "POST", "POST", "GET"])
        let firstBody = try #require(requests.first?.httpBody)
        #expect(requests.prefix(4).allSatisfy { $0.httpBody == firstBody })
        #expect(await delays.values == [1_000_000_000, 3_000_000_000, 4_000_000_000])
        #expect(await store.saved?.state == target.state)

        let canceledHTTP = RetriedMailHTTP(descriptor: Data())
        let canceledStore = TrustStore()
        let canceledClient = OmnipolymathIDNodeEnrollmentClient(
            http: canceledHTTP,
            trustStore: canceledStore,
            now: { fixture.now },
            sleep: { _ in throw CancellationError() })
        await #expect(throws: CancellationError.self) {
            try await canceledClient.enroll(
                joinLink: fixture.node_invite.link,
                discoveryOrigin: "https://discovery.example",
                identity: identity,
                description: description(),
                onVerificationCode: { _ in })
        }
        #expect(await canceledHTTP.requests.count == 1)
        #expect(await canceledStore.saved == nil)
    }

    private actor RetryDelays {
        var values: [UInt64] = []
        func append(_ value: UInt64) {
            self.values.append(value)
        }
    }

    private actor RetriedMailHTTP: OmnipolymathIDNodeEnrollmentHTTP {
        let descriptor: Data
        var requests: [URLRequest] = []
        init(descriptor: Data) {
            self.descriptor = descriptor
        }

        func send(_ request: URLRequest) throws -> OmnipolymathIDNodeEnrollmentHTTPResponse {
            self.requests.append(request)
            switch self.requests.count {
            case 1: throw URLError(.networkConnectionLost) // The server may have accepted this mail.
            case 2: return .init(status: 429, body: Data("{\"error\":{\"retry_after\":3}}".utf8))
            case 3: return .init(status: 503, body: Data())
            case 4: return .init(status: 202, body: Data())
            default: return .init(status: 200, body: self.descriptor)
            }
        }
    }

    @Test func `redirects oversize and cancellation never commit`() async throws {
        let (fixture, json) = try fixture()
        let identity = try OmnipolymathIDNodeIdentity(seed: OmnipolymathIDNodeIdentity.unhex(fixture.node_key.seed_hex))
        let description = try description()
        for bad in [
            OmnipolymathIDNodeEnrollmentHTTPResponse(status: 302, body: Data()),
            .init(status: 200, body: Data(repeating: 32, count: 1_048_577)),
            .init(status: 200, body: Data("{}".utf8)),
        ] {
            let store = TrustStore()
            let http = ScriptedHTTP(responses: [.init(status: 202, body: Data()), bad])
            let client = OmnipolymathIDNodeEnrollmentClient(http: http, trustStore: store, now: { fixture.now })
            await #expect(throws: (any Error).self) {
                try await client.enroll(
                    joinLink: fixture.node_invite.link,
                    discoveryOrigin: "https://discovery.example",
                    identity: identity,
                    description: description,
                    onVerificationCode: { _ in })
            }
            #expect(await store.saved == nil)
        }
        let store = TrustStore()
        let http = try ScriptedHTTP(responses: [
            .init(status: 202, body: Data()),
            .init(status: 200, body: #require(json["response"]).encoded),
        ])
        let client = OmnipolymathIDNodeEnrollmentClient(http: http, trustStore: store, now: { fixture.now })
        let task = Task {
            withUnsafeCurrentTask { $0?.cancel() }
            return try await client.enroll(
                joinLink: fixture.node_invite.link,
                discoveryOrigin: "https://discovery.example",
                identity: identity,
                description: description,
                onVerificationCode: { _ in })
        }
        await #expect(throws: (any Error).self) { try await task.value }
        #expect(await store.saved == nil)
        #expect(await http.requests.isEmpty)
    }

    @Test func `refused verified observations block later enrollment replay`() async throws {
        let (fixture, json) = try fixture()
        let identity = try OmnipolymathIDNodeIdentity(seed: OmnipolymathIDNodeIdentity.unhex(fixture.node_key.seed_hex))
        let manifest = try description()
        let original = try #require(json["response"])
        // Each scenario uses two real enrollment attempts and one retained state owner.
        for scenario in ["higher-binding", "stale", "excluded", "future", "bad-signature"] {
            var response = try original.fields(["descriptor", "snapshot"])
            var snapshot = try #require(response["snapshot"]).fields(["v", "type", "body", "signer", "alg", "sig"])
            guard case var .object(body) = try #require(snapshot["body"])
            else { throw OmnipolymathIDNodeEnrollmentError.malformed }
            body["seq"] = .integer(3)
            if scenario == "higher-binding" { body["binding_seq"] = .integer(2) }
            if scenario == "stale" { body["issued_at"] = .integer(fixture.now - 10801) }
            if scenario == "excluded" { body["node_peer_keys"] = .array([]) }
            if scenario == "future" { body["issued_at"] = .integer(fixture.now + 301) }
            snapshot["body"] = .object(body)
            if scenario != "bad-signature" {
                let gateway = try Curve25519.Signing.PrivateKey(rawRepresentation:
                    OmnipolymathIDNodeIdentity.unhex(#require(json["gateway_seed_hex"]).text()))
                let signature = try gateway.signature(for: Data("omnipolymath/MembershipSnapshot/v1\0".utf8) +
                    OmnipolymathIDCanonicalJSON.object(body).encoded)
                snapshot["sig"] = .string(OmnipolymathIDNodeIdentity.base64URL(signature))
            }
            response["snapshot"] = .object(snapshot)
            let store = TrustStore()
            let http = ScriptedHTTP(responses: [
                .init(status: 202, body: Data()),
                .init(status: 200, body: OmnipolymathIDCanonicalJSON.object(response).encoded),
                .init(status: 202, body: Data()),
                .init(status: 200, body: original.encoded),
            ])
            let client = OmnipolymathIDNodeEnrollmentClient(http: http, trustStore: store, now: { fixture.now })
            let attempt = {
                try await client.enroll(
                    joinLink: fixture.node_invite.link,
                    discoveryOrigin: "https://discovery.example",
                    identity: identity,
                    description: manifest,
                    onVerificationCode: { _ in })
            }
            await #expect(throws: (any Error).self) { try await attempt() }
            #expect(await store.saved == nil)
            let remembered = ["stale", "excluded"].contains(scenario)
            #expect(await store.observed?.snapshotSequence == (remembered ? 3 : 0))
            if remembered {
                // This fresh-looking older snapshot was accepted before refused observations were retained.
                await #expect(throws: OmnipolymathIDNodeEnrollmentError.rollback) { try await attempt() }
                #expect(await store.observed?.snapshotSequence == 3)
                #expect(await store.saved == nil)
            } else {
                // Neither a future nor an unverified assertion may poison honest evidence.
                let target = try await attempt()
                #expect(target.state.snapshotSequence == 2)
                #expect(await store.saved?.state == target.state)
            }
        }
    }

    @Test func `retains binding retirement and membership order independently across refused evidence`() async throws {
        let (fixture, json) = try fixture()
        let root = try Curve25519.Signing.PrivateKey(rawRepresentation: Data(repeating: 42, count: 32))
        let rootPublic = "ed25519:" + OmnipolymathIDNodeIdentity.hex(root.publicKey.rawRepresentation)
        let fingerprint = OmnipolymathIDNodeIdentity.hex(SHA256.hash(data: root.publicKey.rawRepresentation))
        let originalLink = try OmnipolymathIDNodeEnrollmentLink(fixture.node_invite.link)
        let joinLink = fixture.node_invite.link.replacingOccurrences(
            of: String(originalLink.rootFingerprint.dropFirst(3)), with: fingerprint)
        let gateway = try Curve25519.Signing.PrivateKey(rawRepresentation:
            OmnipolymathIDNodeIdentity.unhex(#require(json["gateway_seed_hex"]).text()))
        let identity = try OmnipolymathIDNodeIdentity(seed: OmnipolymathIDNodeIdentity.unhex(fixture.node_key.seed_hex))
        let manifest = try description()
        let store = TrustStore()
        func signed(
            _ envelope: OmnipolymathIDCanonicalJSON,
            updates: [String: OmnipolymathIDCanonicalJSON],
            key: Curve25519.Signing.PrivateKey) throws -> OmnipolymathIDCanonicalJSON
        {
            var fields = try envelope.fields(["v", "type", "body", "signer", "alg", "sig"])
            guard case var .object(body) = try #require(fields["body"])
            else { throw OmnipolymathIDNodeEnrollmentError.malformed }
            body.merge(updates) { _, new in new }
            fields["body"] = .object(body)
            fields["signer"] = .string("ed25519:" + OmnipolymathIDNodeIdentity.hex(key.publicKey.rawRepresentation))
            let type = try #require(fields["type"]).text()
            fields["sig"] = try .string(OmnipolymathIDNodeIdentity.base64URL(key.signature(
                for: Data("omnipolymath/\(type)/v1\0".utf8) + OmnipolymathIDCanonicalJSON.object(body).encoded)))
            return .object(fields)
        }
        // Refused (lagging) evidence still records verified binding 5 and the newest membership order;
        // a later snapshot older than that order is a replay. Retirement comes only from a verified
        // binding, never a snapshot's claim (J5).
        let evidence: [(Int64, Int64, Int64)] = [(5, 9, 4), (5, 10, 4), (5, 10, 4), (5, 8, 5)]
        for (index, values) in evidence.enumerated() {
            let (bindingSequence, sequence, snapshotBinding) = values
            var response = try #require(json["response"]).fields(["descriptor", "snapshot"])
            var descriptor = try #require(response["descriptor"]).fields([
                "v", "claw_id", "transport", "relay_url", "root_pub", "binding", "published_at",
            ])
            descriptor["root_pub"] = .string(rootPublic)
            descriptor["binding"] = try signed(
                #require(descriptor["binding"]),
                updates: ["binding_seq": .integer(bindingSequence)],
                key: root)
            response["descriptor"] = .object(descriptor)
            response["snapshot"] = try signed(
                #require(response["snapshot"]),
                updates: [
                    "seq": .integer(sequence),
                    "binding_seq": .integer(snapshotBinding),
                ],
                key: gateway)
            let http = ScriptedHTTP(responses: [
                .init(status: 202, body: Data()),
                .init(
                    status: 200,
                    body: OmnipolymathIDCanonicalJSON.object(response).encoded),
            ])
            let client = OmnipolymathIDNodeEnrollmentClient(http: http, trustStore: store, now: { fixture.now })
            await #expect(throws: OmnipolymathIDNodeEnrollmentError.rollback) {
                try await client.enroll(
                    joinLink: joinLink,
                    discoveryOrigin: "https://discovery.example",
                    identity: identity,
                    description: manifest,
                    onVerificationCode: { _ in })
            }
            #expect(await store.observed?.snapshotSequence == (index == 0 ? 9 : 10))
            #expect(await store.observed?.snapshotBindingSequence == 5)
            #expect(await store.saved == nil)
        }
    }

    @Test func `inflated snapshot is refused unkept and A rebind under new keys is dialed`() async throws {
        let (fixture, json) = try fixture()
        let root = try Curve25519.Signing.PrivateKey(rawRepresentation: Data(repeating: 42, count: 32))
        let fingerprint = OmnipolymathIDNodeIdentity.hex(SHA256.hash(data: root.publicKey.rawRepresentation))
        let original = try OmnipolymathIDNodeEnrollmentLink(fixture.node_invite.link)
        let link = try OmnipolymathIDNodeEnrollmentLink(fixture.node_invite.link.replacingOccurrences(
            of: String(original.rootFingerprint.dropFirst(3)), with: fingerprint))
        let origin = try OmnipolymathIDNodeEnrollmentLink.discoveryOrigin("https://discovery.example")
        let oldGateway = try Curve25519.Signing.PrivateKey(rawRepresentation:
            OmnipolymathIDNodeIdentity.unhex(#require(json["gateway_seed_hex"]).text()))
        let newGateway = try Curve25519.Signing.PrivateKey(rawRepresentation: Data(repeating: 43, count: 32))
        let base = try #require(json["response"]).fields(["descriptor", "snapshot"])
        func signed(
            _ envelope: OmnipolymathIDCanonicalJSON,
            _ updates: [String: OmnipolymathIDCanonicalJSON],
            _ key: Curve25519.Signing.PrivateKey) throws -> OmnipolymathIDCanonicalJSON
        {
            var fields = try envelope.fields(["v", "type", "body", "signer", "alg", "sig"])
            guard case var .object(body) = try #require(fields["body"])
            else { throw OmnipolymathIDNodeEnrollmentError.malformed }
            body.merge(updates) { _, new in new }
            fields["body"] = .object(body)
            fields["signer"] = .string("ed25519:" + OmnipolymathIDNodeIdentity.hex(key.publicKey.rawRepresentation))
            let type = try #require(fields["type"]).text()
            fields["sig"] = try .string(OmnipolymathIDNodeIdentity.base64URL(key.signature(
                for: Data("omnipolymath/\(type)/v1\0".utf8) + OmnipolymathIDCanonicalJSON.object(body).encoded)))
            return .object(fields)
        }
        // Binding `binding` signed by R names `gateway`; the snapshot is signed by that K_gw.
        func assess(
            binding: Int64,
            gateway: Curve25519.Signing.PrivateKey,
            seq: Int64,
            claims: Int64,
            previous: OmnipolymathIDNodeTrustState?,
            at now: Int64) throws -> OmnipolymathIDNodeTrustAssessment
        {
            var response = base
            var descriptor = try #require(response["descriptor"]).fields([
                "v", "claw_id", "transport", "relay_url", "root_pub", "binding", "published_at",
            ])
            descriptor["root_pub"] = .string("ed25519:" + OmnipolymathIDNodeIdentity.hex(root.publicKey.rawRepresentation))
            descriptor["binding"] = try signed(
                #require(descriptor["binding"]),
                [
                    "binding_seq": .integer(binding),
                    "k_gw": .string("ed25519:" + OmnipolymathIDNodeIdentity.hex(gateway.publicKey.rawRepresentation)),
                ],
                root)
            response["descriptor"] = .object(descriptor)
            response["snapshot"] = try signed(
                #require(response["snapshot"]),
                [
                    "seq": .integer(seq),
                    "binding_seq": .integer(claims),
                    "issued_at": .integer(now),
                ],
                gateway)
            return try OmnipolymathIDNodeTrust.assess(
                response: OmnipolymathIDCanonicalJSON.object(response).encoded,
                link: link,
                discoveryOrigin: origin,
                peerKey: fixture.node_key.iroh,
                previous: previous,
                now: now)
        }
        // The first response can contain a verified binding with an inflated snapshot. Retain
        // that binding's pin even though no snapshot/route has ever been accepted, across restart.
        let first = try assess(
            binding: 2,
            gateway: newGateway,
            seq: 50,
            claims: 9,
            previous: nil,
            at: fixture.now)
        #expect(throws: OmnipolymathIDNodeEnrollmentError.rollback) { try first.verdict.get() }
        let pinned = try #require(first.observation)
        #expect(pinned.bindingSequence == 2)
        #expect(pinned.snapshotSequence == 0 && pinned.snapshotIssuedAt == 0)
        #expect(pinned.snapshotBindingSequence == 2 && pinned.snapshotGatewayKey == nil)
        let directory = URL(fileURLWithPath: ProcessInfo.processInfo.environment["TMPDIR"] ?? NSTemporaryDirectory())
            .appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let url = directory.appendingPathComponent("node-enrollment.sqlite")
        let id = UUID()
        let store = OmnipolymathIDNodeNativeTrustStore(databaseURL: url, enrollmentID: id, assertCurrent: {})
        try await store.observe(hostname: link.hostname, state: pinned)
        #expect(try await store.savedEnrollment(hostname: link.hostname) == nil)
        await store.close()
        let reopened = OmnipolymathIDNodeNativeTrustStore(databaseURL: url, enrollmentID: id, assertCurrent: {})
        let restored = try #require(await reopened.load(hostname: link.hostname))
        #expect(restored == pinned)
        #expect(throws: OmnipolymathIDNodeEnrollmentError.rollback) {
            try assess(
                binding: 1,
                gateway: oldGateway,
                seq: 51,
                claims: 1,
                previous: restored,
                at: fixture.now + 1)
        }
        await reopened.close()
        let admitted = try assess(binding: 1, gateway: oldGateway, seq: 7, claims: 1, previous: nil, at: fixture.now)
        let state = try admitted.verdict.get().state
        // The old K_gw alone signs binding_seq 9: refused, and nothing of it is kept.
        let inflated = try assess(
            binding: 1,
            gateway: oldGateway,
            seq: 50,
            claims: 9,
            previous: state,
            at: fixture.now + 1)
        #expect(throws: OmnipolymathIDNodeEnrollmentError.rollback) { try inflated.verdict.get() }
        #expect(inflated.observation == state)
        // R's binding 2 names a new K_gw whose order restarts below the old key's 7.
        let rebound = try assess(
            binding: 2,
            gateway: newGateway,
            seq: 1,
            claims: 2,
            previous: inflated.observation,
            at: fixture.now + 2)
        let next = try rebound.verdict.get().state
        #expect(next.bindingSequence == 2 && next.snapshotSequence == 1 && next.snapshotBindingSequence == 2)
        try OmnipolymathIDNodeTrust.validateCommit(next, replacing: state)
        // The retired binding is refused before any of its evidence is considered.
        #expect(throws: OmnipolymathIDNodeEnrollmentError.rollback) {
            try assess(binding: 1, gateway: oldGateway, seq: 8, claims: 1, previous: next, at: fixture.now + 3)
        }
    }

    @Test func `native store loads A keyless row capped at the pin without order`() async throws {
        let directory = URL(fileURLWithPath: ProcessInfo.processInfo.environment["TMPDIR"] ?? NSTemporaryDirectory())
            .appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let url = directory.appendingPathComponent("node-enrollment.sqlite")
        let database = try OmnipolymathIDNodeStateSchema.open(databaseURL: url)
        // A row without a key, whose snapshot binding 9 and seq 50 came from an inflated snapshot.
        try database.execute("""
        INSERT INTO omnipolymath_id_node_targets (hostname, claw_id, root_fingerprint, binding_sequence,
          snapshot_sequence, snapshot_issued_at, snapshot_binding_sequence)
        VALUES ('studio.example.test', '0123456789abcdef0123456789abcdef', 'fp:00', 1, 50, 100, 9)
        """)
        let store = OmnipolymathIDNodeNativeTrustStore(databaseURL: url, enrollmentID: UUID(), assertCurrent: {})
        #expect(try await store.load(hostname: "studio.example.test") == .init(
            clawID: "0123456789abcdef0123456789abcdef",
            rootFingerprint: "fp:00",
            bindingSequence: 1,
            snapshotSequence: 0,
            snapshotIssuedAt: 0,
            snapshotBindingSequence: 1))
        await store.close()
    }

    @Test func `observations merge by snapshot order and dial commit checks current row`() throws {
        let (fixture, _) = try fixture()
        let link = try OmnipolymathIDNodeEnrollmentLink(fixture.node_invite.link)
        let state: (Int64, Int64, Int64, Int64) -> OmnipolymathIDNodeTrustState = { pin, seq, issued, binding in
            .init(
                clawID: link.clawID,
                rootFingerprint: link.rootFingerprint,
                bindingSequence: pin,
                snapshotSequence: seq,
                snapshotIssuedAt: issued,
                snapshotBindingSequence: binding)
        }
        let current = state(2, 4, 100, 3)
        // Late observers cannot overwrite a newer row or reduce its separately verified binding pin.
        #expect(try OmnipolymathIDNodeTrust.mergeObservation(state(1, 3, 200, 1), with: current) == current)
        let newer = try OmnipolymathIDNodeTrust.mergeObservation(state(1, 4, 101, 2), with: current)
        #expect(newer == state(2, 4, 101, 3))
        #expect(try OmnipolymathIDNodeTrust.mergeObservation(state(1, 5, 90, 2), with: current) == state(2, 5, 90, 3))
        #expect(throws: OmnipolymathIDNodeEnrollmentError.rollback) {
            try OmnipolymathIDNodeTrust.validateCommit(state(2, 4, 100, 2), replacing: current)
        }
        #expect(throws: OmnipolymathIDNodeEnrollmentError.rollback) {
            try OmnipolymathIDNodeTrust.validateCommit(state(3, 3, 200, 3), replacing: current)
        }
    }

    @Test func `same host enrollment keeps selected restart identity`() async throws {
        let (fixture, json) = try fixture()
        let link = try OmnipolymathIDNodeEnrollmentLink(fixture.node_invite.link)
        let origin = try #require(URL(string: "https://discovery.example"))
        let firstID = UUID()
        let secondID = UUID()
        let secondIdentity = try OmnipolymathIDNodeIdentity(seed: Data(repeating: 89, count: 32))
        var response = try #require(json["response"]).fields(["descriptor", "snapshot"])
        var envelope = try #require(response["snapshot"]).fields(["v", "type", "body", "signer", "alg", "sig"])
        guard case var .object(body) = try #require(envelope["body"])
        else { throw OmnipolymathIDNodeEnrollmentError.malformed }
        body["node_peer_keys"] = .array([.string(fixture.node_key.iroh), .string(secondIdentity.peerKey)])
        envelope["body"] = .object(body)
        let gateway = try Curve25519.Signing.PrivateKey(rawRepresentation:
            OmnipolymathIDNodeIdentity.unhex(#require(json["gateway_seed_hex"]).text()))
        envelope["sig"] = try .string(OmnipolymathIDNodeIdentity.base64URL(gateway.signature(
            for: Data("omnipolymath/MembershipSnapshot/v1\0".utf8) + OmnipolymathIDCanonicalJSON.object(body).encoded)))
        response["snapshot"] = .object(envelope)
        let evidence = OmnipolymathIDCanonicalJSON.object(response).encoded
        let first = try OmnipolymathIDNodeTrust.assess(
            response: evidence,
            link: link,
            discoveryOrigin: origin,
            peerKey: fixture.node_key.iroh,
            previous: nil,
            now: fixture.now)
            .verdict.get()
        let second = try OmnipolymathIDNodeTrust.assess(
            response: evidence,
            link: link,
            discoveryOrigin: origin,
            peerKey: secondIdentity.peerKey,
            previous: first.state,
            now: fixture.now).verdict.get()
        let directory = URL(fileURLWithPath: ProcessInfo.processInfo.environment["TMPDIR"] ?? NSTemporaryDirectory())
            .appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let database = directory.appendingPathComponent("trust.sqlite")
        let selected = OmnipolymathIDNodeNativeTrustStore(databaseURL: database, enrollmentID: firstID, assertCurrent: {})
        try await selected.commit(first)
        await selected.close()
        // A second admitted attempt finishes before the app's Check step selects its identity.
        let pending = OmnipolymathIDNodeNativeTrustStore(databaseURL: database, enrollmentID: secondID, assertCurrent: {})
        try await pending.commit(second)
        await pending.close()
        let reopened = OmnipolymathIDNodeNativeTrustStore(databaseURL: database, enrollmentID: firstID, assertCurrent: {})
        let saved = try #require(await reopened.savedEnrollment(hostname: link.hostname))
        #expect(saved.enrollmentID == firstID)
        #expect(saved.peerKey == fixture.node_key.iroh)
        await reopened.close()
        let alternate = OmnipolymathIDNodeNativeTrustStore(databaseURL: database, enrollmentID: secondID, assertCurrent: {})
        #expect(try await alternate.savedEnrollment(hostname: link.hostname)?.peerKey == secondIdentity.peerKey)
        await alternate.close()
    }

    @Test func `native store migrates and retains independent high water across reopen`() async throws {
        let directory = URL(fileURLWithPath: ProcessInfo.processInfo.environment["TMPDIR"] ?? NSTemporaryDirectory())
            .appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let url = directory.appendingPathComponent("node-enrollment.sqlite")
        // A database from before this feature has no node table or version marker.
        do {
            let empty = try OmnipolymathNativeStateSQLite(databaseURL: url)
            #expect(try empty.scalarInt64("PRAGMA user_version") == 0)
            #expect(try !empty.schemaObjectExists(type: "table", name: "omnipolymath_id_node_targets"))
        }
        let (fixture, json) = try fixture()
        let link = try OmnipolymathIDNodeEnrollmentLink(fixture.node_invite.link)
        let identity = try OmnipolymathIDNodeIdentity(seed: OmnipolymathIDNodeIdentity.unhex(fixture.node_key.seed_hex))
        let enrollmentID = UUID()
        let store = OmnipolymathIDNodeNativeTrustStore(databaseURL: url, enrollmentID: enrollmentID, assertCurrent: {})
        let http = try ScriptedHTTP(responses: [
            .init(status: 202, body: Data()),
            .init(status: 200, body: #require(json["response"]).encoded),
        ])
        let target = try await OmnipolymathIDNodeEnrollmentClient(http: http, trustStore: store, now: { fixture.now })
            .enroll(
                joinLink: fixture.node_invite.link,
                discoveryOrigin: "https://discovery.example",
                identity: identity,
                description: self.description(),
                onVerificationCode: { _ in })
        await store.close()
        let reopened = OmnipolymathIDNodeNativeTrustStore(databaseURL: url, enrollmentID: enrollmentID, assertCurrent: {})
        #expect(try await reopened.load(hostname: link.hostname) == target.state)
        let saved = try #require(await reopened.savedEnrollment(hostname: link.hostname))
        #expect(saved.enrollmentID == enrollmentID)
        #expect(saved.peerKey == identity.peerKey)
        #expect(saved.discoveryOrigin == target.discoveryOrigin)
        #expect(saved.evidence == target.evidence)
        let refreshHTTP = try ScriptedHTTP(responses: [.init(status: 200, body: #require(json["response"]).encoded)])
        let refreshed = try await OmnipolymathIDNodeEnrollmentClient(
            http: refreshHTTP,
            trustStore: reopened,
            now: { fixture.now }).refresh(
            hostname: link.hostname,
            enrollment: saved,
            identity: identity)
        #expect(refreshed.state == target.state)
        #expect(await refreshHTTP.requests.map(\.httpMethod) == ["GET"])
        // Two owners see current durable facts, not the rows loaded at the start of their attempts.
        let other = OmnipolymathIDNodeNativeTrustStore(databaseURL: url, enrollmentID: UUID(), assertCurrent: {})
        for (owner, sequence, retirement) in [(reopened, Int64(9), Int64(5)), (other, Int64(10), Int64(4))] {
            try await owner.observe(hostname: link.hostname, state: .init(
                clawID: link.clawID,
                rootFingerprint: link.rootFingerprint,
                bindingSequence: 4,
                snapshotSequence: sequence,
                snapshotIssuedAt: fixture.now,
                snapshotBindingSequence: retirement,
                snapshotGatewayKey: target.state
                    .snapshotGatewayKey))
        }
        await #expect(throws: OmnipolymathIDNodeEnrollmentError.rollback) { try await reopened.commit(target) }
        await reopened.close()
        await other.close()
        let final = OmnipolymathIDNodeNativeTrustStore(databaseURL: url, enrollmentID: enrollmentID, assertCurrent: {})
        let state = try #require(await final.load(hostname: link.hostname))
        #expect(state.bindingSequence == 4)
        #expect(state.snapshotSequence == 10)
        #expect(state.snapshotBindingSequence == 5)
        // Saved routes remain restart inputs, never a dial target bypassing fresh verification.
        #expect(try await final.savedEnrollment(hostname: link.hostname)?.enrollmentID == enrollmentID)
        let replayHTTP = try ScriptedHTTP(responses: [.init(status: 200, body: #require(json["response"]).encoded)])
        let reconnect = OmnipolymathIDNodeEnrollmentClient(http: replayHTTP, trustStore: final, now: { fixture.now })
        await #expect(throws: OmnipolymathIDNodeEnrollmentError.rollback) {
            try await reconnect.refresh(hostname: link.hostname, enrollment: saved, identity: identity)
        }
        #expect(await replayHTTP.requests.map(\.httpMethod) == ["GET"])
        await final.close()
        let database = try OmnipolymathIDNodeStateSchema.open(databaseURL: url)
        #expect(try database.scalarInt64("PRAGMA user_version") == OmnipolymathIDNodeStateSchema.version)
        #expect(try database.scalarInt64("PRAGMA synchronous") == 2)
        let columns = try database.prepare("PRAGMA table_info(omnipolymath_id_node_targets)")
        var names: [String] = []
        while try columns.step() == .row {
            try names.append(columns.requiredText(at: 1, field: "column"))
        }
        #expect(names == [
            "hostname",
            "claw_id",
            "root_fingerprint",
            "binding_sequence",
            "snapshot_sequence",
            "snapshot_issued_at",
            "snapshot_binding_sequence",
            "snapshot_gateway_key",
        ])
        let enrollmentColumns = try database.prepare("PRAGMA table_info(omnipolymath_id_node_enrollments)")
        var enrollmentNames: [String] = []
        while try enrollmentColumns.step() == .row {
            try enrollmentNames.append(enrollmentColumns.requiredText(at: 1, field: "column"))
        }
        #expect(enrollmentNames == [
            "hostname",
            "enrollment_id",
            "discovery_origin",
            "relay_url",
            "server_key",
            "peer_key",
            "evidence_json",
        ])
    }

    @Test(arguments: [
        false,
        true,
    ]) func `native storage failure never returns dial target`(failCommit: Bool) async throws {
        let directory = URL(fileURLWithPath: ProcessInfo.processInfo.environment["TMPDIR"] ?? NSTemporaryDirectory())
            .appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let url = directory.appendingPathComponent("node-enrollment.sqlite")
        let (fixture, json) = try fixture()
        let link = try OmnipolymathIDNodeEnrollmentLink(fixture.node_invite.link)
        let identity = try OmnipolymathIDNodeIdentity(seed: OmnipolymathIDNodeIdentity.unhex(fixture.node_key.seed_hex))
        let store = OmnipolymathIDNodeNativeTrustStore(databaseURL: url, enrollmentID: UUID(), assertCurrent: {})
        #expect(try await store.load(hostname: link.hostname) == nil)
        // Inject an actual SQLite write failure, separately at observation and target commit.
        let database = try OmnipolymathNativeStateSQLite(databaseURL: url, createIfMissing: false)
        let table = failCommit ? "omnipolymath_id_node_enrollments" : "omnipolymath_id_node_targets"
        try database
            .execute(
                "CREATE TRIGGER fail_write BEFORE INSERT ON \(table) " +
                    "BEGIN SELECT RAISE(ABORT, 'storage unavailable'); END")
        let http = try ScriptedHTTP(responses: [
            .init(status: 202, body: Data()),
            .init(status: 200, body: #require(json["response"]).encoded),
        ])
        let client = OmnipolymathIDNodeEnrollmentClient(http: http, trustStore: store, now: { fixture.now })
        await #expect(throws: OmnipolymathNativeStateError.self) {
            try await client.enroll(
                joinLink: fixture.node_invite.link,
                discoveryOrigin: "https://discovery.example",
                identity: identity,
                description: description(),
                onVerificationCode: { _ in })
        }
        #expect(try await store.savedEnrollment(hostname: link.hostname) == nil)
        #expect(try await store.load(hostname: link.hostname)?.snapshotSequence == (failCommit ? 2 : nil))
        try database.execute("DROP TRIGGER fail_write")
        await store.close()
    }

    @Test func `native store rejects foreign schema and revoked attempt`() async throws {
        let directory = URL(fileURLWithPath: ProcessInfo.processInfo.environment["TMPDIR"] ?? NSTemporaryDirectory())
            .appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let foreignURL = directory.appendingPathComponent("foreign.sqlite")
        let foreign = try OmnipolymathNativeStateSQLite(databaseURL: foreignURL)
        try foreign.execute("CREATE TABLE sqliteXforeign (value TEXT)")
        #expect(throws: OmnipolymathNativeStateError.self) { try OmnipolymathIDNodeStateSchema.open(databaseURL: foreignURL) }
        #expect(try foreign.scalarInt64("PRAGMA user_version") == 0)
        #expect(try !foreign.schemaObjectExists(type: "table", name: "omnipolymath_id_node_targets"))

        let injectedURL = directory.appendingPathComponent("extra-trigger.sqlite")
        let injected = try OmnipolymathIDNodeStateSchema.open(databaseURL: injectedURL)
        try injected.execute("""
        CREATE TRIGGER sqliteXignore BEFORE INSERT ON omnipolymath_id_node_targets
        BEGIN SELECT RAISE(IGNORE); END
        """)
        #expect(throws: OmnipolymathNativeStateError.self) { try OmnipolymathIDNodeStateSchema.open(databaseURL: injectedURL) }

        let (fixture, json) = try fixture()
        let target = try OmnipolymathIDNodeTrust.assess(
            response: #require(json["response"]).encoded,
            link: OmnipolymathIDNodeEnrollmentLink(fixture.node_invite.link),
            discoveryOrigin: OmnipolymathIDNodeEnrollmentLink
                .discoveryOrigin("https://discovery.example"),
            peerKey: fixture.node_key.iroh,
            previous: nil,
            now: fixture.now)
            .verdict.get()
        let revoked = Mutex(false)
        let store = OmnipolymathIDNodeNativeTrustStore(
            databaseURL: directory.appendingPathComponent("node.sqlite"),
            enrollmentID: UUID(),
            assertCurrent: {
                if revoked
                    .withLock({ $0 })
                {
                    throw OmnipolymathIDNodeEnrollmentError.notAdmitted
                }
            })
        #expect(try await store.load(hostname: target.hostname) == nil)
        revoked.withLock { $0 = true }
        await #expect(throws: OmnipolymathIDNodeEnrollmentError.notAdmitted) {
            try await store.observe(hostname: target.hostname, state: target.state)
        }
        await #expect(throws: OmnipolymathIDNodeEnrollmentError.notAdmitted) { try await store.commit(target) }
        revoked.withLock { $0 = false }
        let canceled = Task {
            withUnsafeCurrentTask { $0?.cancel() }
            try await store.commit(target)
        }
        await #expect(throws: CancellationError.self) { try await canceled.value }
        #expect(try await store.load(hostname: target.hostname) == nil)
        #expect(try await store.savedEnrollment(hostname: target.hostname) == nil)
        await store.close()
        await #expect(throws: OmnipolymathNativeStateError.self) { try await store.commit(target) }
    }

    private actor Codes {
        var values: [String] = []
        func append(_ code: String) {
            self.values.append(code)
        }
    }

    private actor TrustStore: OmnipolymathIDNodeTrustStore {
        var saved: OmnipolymathIDNodeTrustTarget?
        var observed: OmnipolymathIDNodeTrustState?
        func load(hostname: String) -> OmnipolymathIDNodeTrustState? {
            self.observed
        }

        func observe(hostname: String, state: OmnipolymathIDNodeTrustState) throws {
            try Task.checkCancellation()
            self.observed = try OmnipolymathIDNodeTrust.mergeObservation(state, with: self.observed)
        }

        func commit(_ target: OmnipolymathIDNodeTrustTarget) throws {
            try Task.checkCancellation()
            try OmnipolymathIDNodeTrust.validateCommit(target.state, replacing: self.observed)
            self.observed = target.state
            self.saved = target
        }
    }

    private actor ScriptedHTTP: OmnipolymathIDNodeEnrollmentHTTP {
        var responses: [OmnipolymathIDNodeEnrollmentHTTPResponse]
        var requests: [URLRequest] = []
        init(responses: [OmnipolymathIDNodeEnrollmentHTTPResponse]) {
            self.responses = responses
        }

        func send(_ request: URLRequest) throws -> OmnipolymathIDNodeEnrollmentHTTPResponse {
            self.requests.append(request)
            guard !self.responses.isEmpty else { throw OmnipolymathIDNodeEnrollmentError.unavailable }
            return self.responses.removeFirst()
        }
    }
}
