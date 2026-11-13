import SwiftUI

struct OmnipolymathDocsScreen: View {
    private let docsURL = URL(string: "https://omnipolymath.vercel.app/docs")!
    private let gatewayURL = URL(string: "https://omnipolymath.vercel.app/docs/gateway")!
    private let pairingURL = URL(string: "https://omnipolymath.vercel.app/docs/channels/pairing")!
    let headerSidebarAction: OmnipolymathSidebarHeaderAction?
    let gatewayAction: () -> Void

    var body: some View {
        ZStack {
            OmnipolymathProBackground()
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    self.headerCard
                    self.linkCard
                }
                .padding(.vertical, 18)
                .font(OmnipolymathType.body)
            }
        }
        .navigationTitle("Docs")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar(.hidden, for: .navigationBar)
    }

    private var headerCard: some View {
        ProCard(radius: OmnipolymathProMetric.cardRadius) {
            OmnipolymathAdaptiveHeaderRow(
                title: "Docs",
                subtitle: "Gateway setup, pairing, channels, and mobile node reference.",
                titleFont: OmnipolymathType.headline,
                subtitleFont: OmnipolymathType.caption)
            {
                HStack(spacing: 10) {
                    if let headerSidebarAction {
                        OmnipolymathSidebarControlButton(action: headerSidebarAction)
                    }
                    ProIconBadge(systemName: "book", color: OmnipolymathBrand.accent)
                }
            } accessory: {
                self.gatewayPill
            }
        }
        .padding(.horizontal, OmnipolymathProMetric.pagePadding)
    }

    private var gatewayPill: some View {
        Button(action: self.gatewayAction) {
            OmnipolymathGatewayCompactPill()
        }
        .buttonBorderShape(.capsule)
        .omnipolymathGlassButton()
        .accessibilityHint("Opens Settings / Gateway")
    }

    private var linkCard: some View {
        ProCard(padding: 0, radius: OmnipolymathProMetric.cardRadius) {
            VStack(spacing: 0) {
                self.docsLinkRow(
                    title: "Docs Home",
                    detail: "Browse the current Omnipolymath reference.",
                    icon: "book",
                    url: self.docsURL)
                Divider().padding(.leading, 58)
                self.docsLinkRow(
                    title: "Gateway",
                    detail: "Connection, auth, and diagnostics.",
                    icon: "network",
                    url: self.gatewayURL)
                Divider().padding(.leading, 58)
                self.docsLinkRow(
                    title: "Pairing",
                    detail: "Mobile setup codes, QR, and node approval.",
                    icon: "qrcode",
                    url: self.pairingURL)
            }
        }
        .padding(.horizontal, OmnipolymathProMetric.pagePadding)
    }

    private func docsLinkRow(title: String, detail: String, icon: String, url: URL) -> some View {
        Link(destination: url) {
            HStack(spacing: 12) {
                ProIconBadge(systemName: icon, color: OmnipolymathBrand.accent)
                VStack(alignment: .leading, spacing: 3) {
                    Text(title)
                        .font(OmnipolymathType.subheadSemiBold)
                    Text(detail)
                        .font(OmnipolymathType.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
                Spacer(minLength: 8)
                Image(systemName: "arrow.up.right")
                    .font(OmnipolymathType.captionBold)
                    .foregroundStyle(.secondary)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 12)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}
