import OmnipolymathKit
import SwiftUI
import UIKit

extension GatewayConnectionProblem.PresentationText {
    var localizedString: String {
        switch self {
        case let .localized(key):
            String(localized: String.LocalizationValue(key))
        case let .localizedFormat(format, arguments):
            String(
                format: String(localized: String.LocalizationValue(format)),
                locale: .current,
                arguments: arguments.map { $0 as CVarArg })
        case let .verbatim(value):
            value
        }
    }
}

extension GatewayConnectionProblem {
    var localizedTitle: String {
        self.titlePresentation.localizedString
    }

    var localizedMessage: String {
        self.messagePresentation.localizedString
    }

    var localizedActionLabel: String? {
        self.actionLabelPresentation?.localizedString
    }

    var localizedStatusText: String {
        switch self.kind {
        case .pairingRequired, .pairingRoleUpgradeRequired, .pairingScopeUpgradeRequired,
             .pairingMetadataUpgradeRequired, .protocolMismatch:
            guard let requestId else { return self.localizedTitle }
            return String(
                format: String(localized: "%@ (request ID: %@)"),
                self.localizedTitle,
                requestId)
        default:
            return self.localizedTitle
        }
    }
}

struct GatewayProblemBanner: View {
    @Environment(\.openURL) private var openURL

    let problem: GatewayConnectionProblem
    var primaryActionTitle: String?
    var onPrimaryAction: (() -> Void)?
    var onShowDetails: (() -> Void)?

    var body: some View {
        OmnipolymathNoticeBanner(
            icon: self.iconName,
            title: .verbatim(self.problem.localizedTitle),
            message: .verbatim(self.problem.localizedMessage),
            ownerLabel: .localized(self.ownerLabel),
            tint: self.tint,
            detail: self.problem.requestId.map(OmnipolymathNoticeDetail.requestID),
            primaryActionTitle: self.primaryActionTitle.map(OmnipolymathTextValue.verbatim),
            onPrimaryAction: self.onPrimaryAction,
            secondaryActionTitle: self.problem.docsURL == GatewayConnectionIssue.tailscaleSetupURL
                ? "Set up Tailscale" : "Details",
            onSecondaryAction: self.secondaryAction)
    }

    private var secondaryAction: (() -> Void)? {
        if self.problem.docsURL == GatewayConnectionIssue.tailscaleSetupURL {
            return {
                self.openURL(GatewayConnectionIssue.tailscaleSetupURL)
            }
        }
        return self.onShowDetails
    }

    private var iconName: String {
        switch self.problem.kind {
        case .pairingRequired,
             .pairingRoleUpgradeRequired,
             .pairingScopeUpgradeRequired,
             .pairingMetadataUpgradeRequired:
            "person.crop.circle.badge.clock"
        case .timeout, .connectionRefused, .reachabilityFailed, .websocketCancelled:
            "wifi.exclamationmark"
        case .deviceIdentityRequired,
             .deviceSignatureExpired,
             .deviceNonceRequired,
             .deviceNonceMismatch,
             .deviceSignatureInvalid,
             .devicePublicKeyInvalid,
             .deviceIdMismatch:
            "lock.shield"
        default:
            "exclamationmark.triangle.fill"
        }
    }

    private var tint: Color {
        switch self.problem.kind {
        case .pairingRequired,
             .pairingRoleUpgradeRequired,
             .pairingScopeUpgradeRequired,
             .pairingMetadataUpgradeRequired:
            OmnipolymathBrand.warn
        case .timeout, .connectionRefused, .reachabilityFailed, .websocketCancelled:
            OmnipolymathBrand.warn
        default:
            OmnipolymathBrand.danger
        }
    }

    private var ownerLabel: String {
        switch self.problem.owner {
        case .gateway:
            "Fix on gateway"
        case .iphone:
            "Fix on this device"
        case .both:
            "Check both"
        case .network:
            "Check network"
        case .unknown:
            "Needs attention"
        }
    }
}

struct GatewayProblemDetailsSheet: View {
    @Environment(\.dismiss) private var dismiss

    let problem: GatewayConnectionProblem
    var primaryActionTitle: String?
    var onPrimaryAction: (() -> Void)?

    @State private var copyFeedback: String?

    var body: some View {
        NavigationStack {
            List {
                Section {
                    VStack(alignment: .leading, spacing: 10) {
                        Text(verbatim: self.problem.localizedTitle)
                            .font(OmnipolymathType.title3)
                        Text(verbatim: self.problem.localizedMessage)
                            .font(OmnipolymathType.body)
                            .foregroundStyle(.secondary)
                        Text(LocalizedStringKey(self.ownerSummary))
                            .font(OmnipolymathType.footnoteSemiBold)
                            .foregroundStyle(.secondary)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.vertical, 4)
                }

                if let requestId = self.problem.requestId {
                    Section {
                        Text(verbatim: requestId)
                            .font(OmnipolymathType.mono)
                            .textSelection(.enabled)
                        Button {
                            UIPasteboard.general.string = requestId
                            self.copyFeedback = "Copied request ID"
                        } label: {
                            Text("Copy request ID")
                                .font(OmnipolymathType.subheadSemiBold)
                        }
                        .font(OmnipolymathType.subheadSemiBold)
                    } header: {
                        Text("Request")
                            .font(OmnipolymathType.captionSemiBold)
                    }
                }

                if let actionCommand = self.problem.actionCommand {
                    Section {
                        Text(verbatim: actionCommand)
                            .font(OmnipolymathType.mono)
                            .textSelection(.enabled)
                        Button {
                            UIPasteboard.general.string = actionCommand
                            self.copyFeedback = "Copied command"
                        } label: {
                            Text("Copy command")
                                .font(OmnipolymathType.subheadSemiBold)
                        }
                        .font(OmnipolymathType.subheadSemiBold)
                    } header: {
                        Text("Gateway command")
                            .font(OmnipolymathType.captionSemiBold)
                    }
                }

                if let docsURL = self.problem.docsURL {
                    Section {
                        Link(destination: docsURL) {
                            Label("Open docs", systemImage: "book")
                                .font(OmnipolymathType.subheadSemiBold)
                        }
                        .font(OmnipolymathType.subheadSemiBold)
                        Text(verbatim: docsURL.absoluteString)
                            .font(OmnipolymathType.footnote)
                            .foregroundStyle(.secondary)
                            .textSelection(.enabled)
                    } header: {
                        Text("Help")
                            .font(OmnipolymathType.captionSemiBold)
                    }
                }

                if let technicalDetails = self.problem.technicalDetails {
                    Section {
                        Text(verbatim: technicalDetails)
                            .font(OmnipolymathType.monoFootnote)
                            .foregroundStyle(.secondary)
                            .textSelection(.enabled)
                    } header: {
                        Text("Technical details")
                            .font(OmnipolymathType.captionSemiBold)
                    }
                }

                if let copyFeedback {
                    Section {
                        Text(verbatim: copyFeedback)
                            .font(OmnipolymathType.footnote)
                            .foregroundStyle(.secondary)
                    }
                }
            }
            .navigationTitle("Connection problem")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .principal) {
                    Text("Connection problem")
                        .font(OmnipolymathType.headline)
                }
                ToolbarItem(placement: .topBarLeading) {
                    if let primaryActionTitle, let onPrimaryAction {
                        Button {
                            self.dismiss()
                            onPrimaryAction()
                        } label: {
                            Text(verbatim: primaryActionTitle)
                                .font(OmnipolymathType.subheadSemiBold)
                        }
                        .font(OmnipolymathType.subheadSemiBold)
                    }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        self.dismiss()
                    } label: {
                        Text("Done")
                            .font(OmnipolymathType.subheadSemiBold)
                    }
                    .font(OmnipolymathType.subheadSemiBold)
                }
            }
        }
    }

    private var ownerSummary: String {
        switch self.problem.owner {
        case .gateway:
            "Primary fix: gateway"
        case .iphone:
            "Primary fix: this device"
        case .both:
            "Primary fix: check both this device and the gateway"
        case .network:
            "Primary fix: network or remote access"
        case .unknown:
            "Primary fix: review details and retry"
        }
    }
}
