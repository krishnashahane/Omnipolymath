import Foundation
import OmnipolymathProtocol

enum GatewayConnectPayload {
    static func makeClient(
        options: GatewayConnectOptions,
        displayName: String,
        platform: String) -> [String: OmnipolymathProtocol.AnyCodable]
    {
        var client: [String: OmnipolymathProtocol.AnyCodable] = [
            "id": OmnipolymathProtocol.AnyCodable(options.clientId),
            "displayName": OmnipolymathProtocol.AnyCodable(displayName),
            "version": OmnipolymathProtocol.AnyCodable(
                Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "dev"),
            "platform": OmnipolymathProtocol.AnyCodable(platform),
            "mode": OmnipolymathProtocol.AnyCodable(options.clientMode),
            "instanceId": OmnipolymathProtocol.AnyCodable(InstanceIdentity.instanceId),
            "deviceFamily": OmnipolymathProtocol.AnyCodable(InstanceIdentity.deviceFamily),
        ]
        if let model = InstanceIdentity.modelIdentifier {
            client["modelIdentifier"] = OmnipolymathProtocol.AnyCodable(model)
        }
        return client
    }
}
