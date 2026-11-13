import AppKit
import OmnipolymathKit
import SwiftUI

struct AboutSettings: View {
    @Environment(\.locale) private var locale
    private let build = ArtifactBuildInfo(infoDictionary: Bundle.main.infoDictionary ?? [:])

    var body: some View {
        VStack(spacing: 18) {
            Image(nsImage: NSApplication.shared.applicationIconImage)
                .resizable()
                .frame(width: 96, height: 96)
                .accessibilityHidden(true)

            VStack(spacing: 5) {
                Text("Omnipolymath")
                    .font(.system(size: 24, weight: .bold))
                Text(String(format: String(localized: "Version %@"), self.build.versionDisplay))
                    .foregroundStyle(.secondary)
                    .textSelection(.enabled)
                Text("The AI that really does things.")
                    .padding(.top, 5)
            }

            HStack(spacing: 20) {
                Link(destination: URL(string: "https://github.com/krishnashahane/Omnipolymath/issues")!) {
                    Label("Support", systemImage: "questionmark.circle")
                }
                Link(destination: URL(string: "https://omnipolymath.vercel.app")!) {
                    Label("Website", systemImage: "globe")
                }
                Link(destination: URL(string: "https://omnipolymath.vercel.app/docs")!) {
                    Label("Docs", systemImage: "book")
                }
                Link(destination: URL(string: "https://github.com/krishnashahane/Omnipolymath")!) {
                    Label("GitHub", systemImage: "chevron.left.forwardslash.chevron.right")
                }
                Link(destination: URL(string: "https://github.com/krishnashahane/Omnipolymath/issues")!) {
                    Label("Discord", systemImage: "bubble.left.and.bubble.right")
                }
            }
            .padding(.vertical, 5)

            Divider()
                .frame(width: 360)

            Grid(horizontalSpacing: 14, verticalSpacing: 6) {
                GridRow {
                    Text("Commit")
                        .gridColumnAlignment(.trailing)
                    Text(self.build.shortCommit ?? String(localized: "Unavailable"))
                        .monospaced()
                        .help(self.build.gitCommit ?? String(localized: "Unavailable"))
                        .gridColumnAlignment(.leading)
                }
                GridRow {
                    Text("Built")
                    Text(self.build.localizedBuildDate(locale: self.locale) ?? String(localized: "Unavailable"))
                        .help(self.build.buildTimestamp ?? String(localized: "Unavailable"))
                }
            }
            .font(.callout)
            .foregroundStyle(.secondary)
            .textSelection(.enabled)

            Button("Copy Build Info", systemImage: "doc.on.doc") {
                NSPasteboard.general.clearContents()
                NSPasteboard.general.setString(self.build.copyText, forType: .string)
            }
            .controlSize(.small)

            Text("© 2026 Krishna Shahane — MIT License.")
                .font(.footnote)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(24)
        .environment(\.openURL, AppActivation.shared.openURLAction)
    }
}
