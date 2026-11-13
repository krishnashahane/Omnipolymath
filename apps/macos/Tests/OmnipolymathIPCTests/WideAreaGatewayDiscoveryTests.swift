import Foundation
import Testing
@testable import OmnipolymathDiscovery

private final class NameserverQueryLog: @unchecked Sendable {
    private let lock = NSLock()
    private var nameservers: [String] = []

    func record(_ nameserver: String) {
        self.lock.lock()
        defer { self.lock.unlock() }
        self.nameservers.append(nameserver)
    }

    func count(matching nameserver: String) -> Int {
        self.lock.lock()
        defer { self.lock.unlock() }
        return self.nameservers.count(where: { $0 == nameserver })
    }
}

@Suite(.serialized)
struct WideAreaGatewayDiscoveryTests {
    @Test func `discovers beacon from tailnet dns sd fallback`() async {
        let statusJson = """
        {
          "Self": { "TailscaleIPs": ["100.69.232.64"] },
          "Peer": {
            "peer-1": { "TailscaleIPs": ["100.123.224.76"] }
          }
        }
        """

        let context = WideAreaGatewayDiscovery.DiscoveryContext(
            tailscaleStatus: { statusJson },
            dig: { args, _ in
                let recordType = args.last ?? ""
                let nameserver = args.first(where: { $0.hasPrefix("@") }) ?? ""
                if recordType == "PTR" {
                    if nameserver == "@100.100.100.100" {
                        return "steipetacstudio-gateway._omnipolymath-gw._tcp.omnipolymath.internal.\n"
                    }
                    return ""
                }
                if recordType == "SRV" {
                    return "0 0 18789 steipetacstudio.omnipolymath.internal."
                }
                if recordType == "TXT" {
                    return "\"displayName=Krishna\\226\\128\\153s Mac Studio (Omnipolymath)\" \"gatewayPort=18789\" \"tailnetDns=example-mac-studio-1.sheep-coho.ts.net\" \"cliPath=/Users/example/omnipolymath/src/entry.ts\""
                }
                return ""
            })

        // Env mutation must hold TestIsolationLock; raw setenv races parallel
        // tests scanning environ (e.g. OMNIPOLYMATH_CONFIG_PATH readers).
        let beacons = await TestIsolation.withEnvValues(
            ["OMNIPOLYMATH_WIDE_AREA_DOMAIN": "omnipolymath.internal"])
        {
            await WideAreaGatewayDiscovery.discover(
                timeoutSeconds: 2.0,
                context: context)
        }

        #expect(beacons.count == 1)
        let beacon = beacons[0]
        let expectedDisplay = "Krishna\u{2019}s Mac Studio (Omnipolymath)"
        #expect(beacon.displayName == expectedDisplay)
        #expect(beacon.port == 18789)
        #expect(beacon.gatewayPort == 18789)
        #expect(beacon.tailnetDns == "example-mac-studio-1.sheep-coho.ts.net")
        #expect(beacon.cliPath == "/Users/example/omnipolymath/src/entry.ts")
    }

    @Test func `attacker peer cannot become nameserver`() async {
        let statusJson = """
        {
          "Self": { "TailscaleIPs": ["100.64.0.1"] },
          "Peer": {
            "attacker": { "TailscaleIPs": ["100.64.0.2"] }
          }
        }
        """

        let queriedNameservers = NameserverQueryLog()
        let context = WideAreaGatewayDiscovery.DiscoveryContext(
            tailscaleStatus: { statusJson },
            dig: { args, _ in
                let nameserver = args.first(where: { $0.hasPrefix("@") }) ?? ""
                queriedNameservers.record(nameserver)

                let recordType = args.last ?? ""
                if recordType == "PTR" {
                    if nameserver == "@100.64.0.2" {
                        return "evil._omnipolymath-gw._tcp.omnipolymath.internal.\n"
                    }
                    return ""
                }
                if recordType == "SRV" {
                    return "0 0 443 evil.ts.net."
                }
                if recordType == "TXT" {
                    return "\"displayName=Evil\""
                }
                return ""
            })

        let beacons = await TestIsolation.withEnvValues(
            ["OMNIPOLYMATH_WIDE_AREA_DOMAIN": "omnipolymath.internal"])
        {
            await WideAreaGatewayDiscovery.discover(
                timeoutSeconds: 2.0,
                context: context)
        }

        #expect(queriedNameservers.count(matching: "@100.64.0.2") == 0)
        #expect(queriedNameservers.count(matching: "@100.100.100.100") == 1)
        #expect(beacons.isEmpty)
    }
}
