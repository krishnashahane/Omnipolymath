import CryptoKit
import Foundation
import Testing
@testable import OmnipolymathKit

struct OmnipolymathIDNodeBindingPinTests {
    @Test(arguments: [false, true])
    func `refused snapshot retains verified binding`(future: Bool) async throws {
        let url = try #require(Bundle.module.url(
            forResource: "OmnipolymathIDNodeEnrollment",
            withExtension: "json",
            subdirectory: "Fixtures"))
        guard case let .object(fixture) = try OmnipolymathIDCanonicalJSON.parse(Data(contentsOf: url)) else {
            throw OmnipolymathIDNodeEnrollmentError.malformed
        }
        let now = try #require(fixture["now"]).number()
        let root = try Curve25519.Signing.PrivateKey(rawRepresentation: Data(repeating: 73, count: 32))
        let gateway = try Curve25519.Signing.PrivateKey(rawRepresentation:
            OmnipolymathIDNodeIdentity.unhex(#require(fixture["gateway_seed_hex"]).text()))
        let fingerprint = "fp:" + OmnipolymathIDNodeIdentity.hex(SHA256.hash(data: root.publicKey.rawRepresentation))
        let invite = try #require(fixture["node_invite"]).fields([
            "link",
            "verification_code",
            "secret_hex",
            "proof_key_hex",
            "proof",
        ])
        let originalLink = try OmnipolymathIDNodeEnrollmentLink(#require(invite["link"]).text())
        let linkText = try #require(invite["link"]).text().replacingOccurrences(
            of: String(originalLink.rootFingerprint.dropFirst(3)),
            with: String(fingerprint.dropFirst(3)))
        let link = try OmnipolymathIDNodeEnrollmentLink(linkText)
        try #require(link.rootFingerprint == fingerprint)
        let node = try #require(fixture["node_key"]).fields(["seed_hex", "ed25519", "iroh", "fp"])
        let peer = try #require(node["iroh"]).text()
        let origin = try #require(URL(string: "https://discovery.example"))
        let original = try #require(fixture["response"]).fields(["descriptor", "snapshot"])
        func signed(
            _ body: OmnipolymathIDCanonicalJSON,
            type: String,
            key: Curve25519.Signing.PrivateKey) throws -> OmnipolymathIDCanonicalJSON
        {
            let signature = try key.signature(for: Data("omnipolymath/\(type)/v1\0".utf8) + body.encoded)
            return .object([
                "v": .integer(1),
                "type": .string(type),
                "body": body,
                "signer": .string("ed25519:" + OmnipolymathIDNodeIdentity.hex(key.publicKey.rawRepresentation)),
                "alg": .string("ed25519"),
                "sig": .string(OmnipolymathIDNodeIdentity.base64URL(signature)),
            ])
        }
        func response(bindingSequence: Int64, refused: Bool) throws -> Data {
            let descriptorValue = try #require(original["descriptor"])
            var descriptor = try descriptorValue.fields([
                "v",
                "claw_id",
                "transport",
                "relay_url",
                "root_pub",
                "binding",
                "published_at",
            ])
            let bindingValue = try #require(descriptor["binding"])
            let envelope = try bindingValue.fields([
                "v",
                "type",
                "body",
                "signer",
                "alg",
                "sig",
            ])
            guard case var .object(binding) = try #require(envelope["body"])
            else { throw OmnipolymathIDNodeEnrollmentError.malformed }
            binding["binding_seq"] = .integer(bindingSequence)
            descriptor["root_pub"] = .string("ed25519:" + OmnipolymathIDNodeIdentity.hex(root.publicKey.rawRepresentation))
            descriptor["binding"] = try signed(.object(binding), type: "ServerBinding", key: root)
            let snapshotValue = try #require(original["snapshot"])
            let snapshotEnvelope = try snapshotValue.fields([
                "v",
                "type",
                "body",
                "signer",
                "alg",
                "sig",
            ])
            guard case var .object(snapshot) = try #require(snapshotEnvelope["body"])
            else { throw OmnipolymathIDNodeEnrollmentError.malformed }
            snapshot["binding_seq"] = .integer(bindingSequence)
            snapshot["issued_at"] = .integer(refused && future ? now + 301 : now)
            var signedSnapshot = try signed(.object(snapshot), type: "MembershipSnapshot", key: gateway)
            if refused, !future {
                var fields = try signedSnapshot.fields(["v", "type", "body", "signer", "alg", "sig"])
                fields["sig"] = .string(OmnipolymathIDNodeIdentity.base64URL(Data(repeating: 0, count: 64)))
                signedSnapshot = .object(fields)
            }
            return OmnipolymathIDCanonicalJSON.object(["descriptor": .object(descriptor), "snapshot": signedSnapshot])
                .encoded
        }
        let oldResponse = try response(bindingSequence: 1, refused: false)
        let previous = try OmnipolymathIDNodeTrust.assess(
            response: oldResponse,
            link: link,
            discoveryOrigin: origin,
            peerKey: peer,
            previous: nil,
            now: now).verdict.get().state
        let directory = URL(fileURLWithPath: ProcessInfo.processInfo.environment["TMPDIR"] ?? NSTemporaryDirectory())
            .appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let database = directory.appendingPathComponent("trust.sqlite")
        let enrollmentID = UUID()
        let store = OmnipolymathIDNodeNativeTrustStore(databaseURL: database, enrollmentID: enrollmentID, assertCurrent: {})
        try await store.observe(hostname: link.hostname, state: previous)
        let assessment = try OmnipolymathIDNodeTrust.assess(
            response: response(bindingSequence: 2, refused: true),
            link: link,
            discoveryOrigin: origin,
            peerKey: peer,
            previous: previous,
            now: now)
        #expect(throws: (any Error).self) { try assessment.verdict.get() }
        let pin = try #require(assessment.observation)
        #expect(pin.bindingSequence == 2)
        #expect(pin.snapshotSequence == previous.snapshotSequence)
        #expect(pin.snapshotIssuedAt == previous.snapshotIssuedAt)
        #expect(pin.snapshotBindingSequence == previous.snapshotBindingSequence)
        try await store.observe(hostname: link.hostname, state: pin)
        await store.close()
        let reopened = OmnipolymathIDNodeNativeTrustStore(
            databaseURL: database,
            enrollmentID: enrollmentID,
            assertCurrent: {})
        let retained = try #require(await reopened.load(hostname: link.hostname))
        #expect(retained.bindingSequence == 2)
        #expect(throws: OmnipolymathIDNodeEnrollmentError.rollback) {
            try OmnipolymathIDNodeTrust.assess(
                response: oldResponse,
                link: link,
                discoveryOrigin: origin,
                peerKey: peer,
                previous: retained,
                now: now).verdict.get()
        }
        await reopened.close()
    }
}
