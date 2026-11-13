import OmnipolymathChatUI
import SwiftUI

enum OmnipolymathProMetric {
    static let pagePadding: CGFloat = 16
    static let cardRadius: CGFloat = 16
    static let controlRadius: CGFloat = 12
    static let compactControlSize: CGFloat = 36
    static let bottomScrollInset: CGFloat = 96
}

enum OmnipolymathRadius {
    static let xs: CGFloat = 8
    static let sm: CGFloat = 10
    static let md: CGFloat = 12
}

enum OmnipolymathTextValue: ExpressibleByStringLiteral {
    case localized(LocalizedStringKey)
    case verbatim(String)

    init(stringLiteral value: String) {
        self = .localized(LocalizedStringKey(value))
    }

    static func localized(_ value: String) -> Self {
        .localized(LocalizedStringKey(value))
    }

    var text: Text {
        switch self {
        case let .localized(key):
            Text(key)
        case let .verbatim(value):
            Text(verbatim: value)
        }
    }
}

struct OmnipolymathProBackground: View {
    var body: some View {
        Color(uiColor: .systemGroupedBackground)
            .ignoresSafeArea()
    }
}

struct ProCard<Content: View>: View {
    var tint: Color?
    var isProminent: Bool = false
    var padding: CGFloat = 12
    var radius: CGFloat = OmnipolymathProMetric.cardRadius
    @ViewBuilder var content: Content

    var body: some View {
        self.content
            .padding(self.padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .proPanelSurface(
                tint: self.tint,
                radius: self.radius,
                isProminent: self.isProminent)
    }
}

extension View {
    @ViewBuilder
    func omnipolymathToolbarGlyphScale() -> some View {
        if #available(iOS 27.1, *) {
            self.modifier(OmnipolymathVerticalToolbarGlyphScale())
        } else {
            self
        }
    }

    @ViewBuilder
    func omnipolymathToolbarHitTarget(preservesIntrinsicWidth: Bool = false) -> some View {
        if #available(iOS 27.1, *) {
            self.modifier(OmnipolymathToolbarHitTarget(preservesIntrinsicWidth: preservesIntrinsicWidth))
        } else if preservesIntrinsicWidth {
            self.frame(minHeight: 44)
        } else {
            self.frame(width: 44, height: 44)
        }
    }

    func proPanelSurface(
        tint: Color? = nil,
        radius: CGFloat = OmnipolymathProMetric.cardRadius,
        isProminent: Bool = false) -> some View
    {
        modifier(ProPanelSurfaceModifier(
            tint: tint,
            radius: radius,
            isProminent: isProminent))
    }

    @ViewBuilder
    func omnipolymathGlassButton(prominent: Bool = false, tint: Color? = nil) -> some View {
        if prominent {
            self
                .font(OmnipolymathType.subheadSemiBold)
                .buttonStyle(.glassProminent)
                .tint(tint ?? OmnipolymathBrand.accentFill)
        } else {
            self
                .font(OmnipolymathType.subheadSemiBold)
                .buttonStyle(.glass)
                .tint(tint)
        }
    }

    func omnipolymathGlassSurface() -> some View {
        self.glassEffect(.regular, in: .rect(cornerRadius: OmnipolymathProMetric.controlRadius))
    }
}

@available(iOS 27.1, *)
private struct OmnipolymathVerticalToolbarGlyphScale: ViewModifier {
    @Environment(\.toolbarVerticalEdge) private var verticalEdge

    func body(content: Content) -> some View {
        // Enlarge only the artwork inside its matching 52pt target. Follow
        // the system bar's actual axis instead of guessing from screen width.
        content.scaleEffect(
            self.verticalEdge != nil && UIDevice.current.userInterfaceIdiom == .phone ? 1.3 : 1)
    }
}

@available(iOS 27.1, *)
private struct OmnipolymathToolbarHitTarget: ViewModifier {
    @Environment(\.toolbarVerticalEdge) private var verticalEdge
    let preservesIntrinsicWidth: Bool

    func body(content: Content) -> some View {
        let isSideToolbar = self.verticalEdge != nil && UIDevice.current.userInterfaceIdiom == .phone
        let size: CGFloat = isSideToolbar ? 52 : 44
        content.frame(
            minWidth: isSideToolbar || !self.preservesIntrinsicWidth ? size : nil,
            maxWidth: isSideToolbar || !self.preservesIntrinsicWidth ? size : nil,
            minHeight: size,
            maxHeight: self.preservesIntrinsicWidth && !isSideToolbar ? nil : size)
    }
}

private struct ProPanelSurfaceModifier: ViewModifier {
    @Environment(\.colorScheme) private var colorScheme
    let tint: Color?
    let radius: CGFloat
    let isProminent: Bool

    func body(content: Content) -> some View {
        content
            .background {
                let shape = RoundedRectangle(cornerRadius: self.radius, style: .continuous)
                shape
                    .fill(Color(uiColor: self.isProminent ? .systemBackground : .secondarySystemGroupedBackground))
                    .overlay {
                        shape.strokeBorder(self.borderStyle, lineWidth: 1)
                    }
            }
            .shadow(
                color: self.isProminent
                    ? (self.colorScheme == .dark ? .black.opacity(0.14) : .black.opacity(0.045))
                    : .clear,
                radius: self.isProminent ? 5 : 0,
                y: self.isProminent ? 2 : 0)
    }

    private var borderStyle: Color {
        if let tint {
            return tint.opacity(self.isProminent ? 0.18 : 0.10)
        }
        return Color(uiColor: .separator).opacity(self.colorScheme == .dark ? 0.22 : 0.12)
    }
}

struct ProIconBadge: View {
    let systemName: String
    let color: Color

    var body: some View {
        Image(systemName: self.systemName)
            .font(OmnipolymathType.captionSemiBold)
            .foregroundStyle(self.color)
            .frame(width: 30, height: 30)
            .background {
                RoundedRectangle(cornerRadius: OmnipolymathRadius.xs, style: .continuous)
                    .fill(self.color.opacity(0.12))
            }
    }
}

struct OmnipolymathSidebarHeaderAction {
    let systemName: String
    let accessibilityLabel: OmnipolymathTextValue
    var accessibilityIdentifier: String?
    let action: () -> Void
}

struct OmnipolymathSidebarControlButton: View {
    let action: OmnipolymathSidebarHeaderAction

    var body: some View {
        self.identified(self.button.buttonStyle(.plain))
    }

    private var button: some View {
        Button(action: self.action.action) {
            Label {
                self.action.accessibilityLabel.text
                    .font(OmnipolymathType.body)
            } icon: {
                self.icon
            }
            .labelStyle(.iconOnly)
        }
        .omnipolymathToolbarHitTarget()
        .contentShape(Rectangle())
        .accessibilityLabel(self.action.accessibilityLabel.text)
    }

    private var icon: some View {
        Image(systemName: self.action.systemName)
            .font(.system(size: 15, weight: .semibold))
            .foregroundStyle(OmnipolymathBrand.accent)
            .omnipolymathToolbarGlyphScale()
            .frame(
                width: OmnipolymathProMetric.compactControlSize,
                height: OmnipolymathProMetric.compactControlSize)
    }

    @ViewBuilder
    private func identified(_ button: some View) -> some View {
        if let accessibilityIdentifier = self.action.accessibilityIdentifier {
            button.accessibilityIdentifier(accessibilityIdentifier)
        } else {
            button
        }
    }
}

struct OmnipolymathSidebarToolbarItem: ToolbarContent {
    let action: OmnipolymathSidebarHeaderAction
    let placement: ToolbarItemPlacement

    @ToolbarContentBuilder
    var body: some ToolbarContent {
        if #available(iOS 27.1, *) {
            self.item.axisBehavior(.verticalPreferred).visibilityPriority(.high)
        } else {
            self.item
        }
    }

    private var item: some ToolbarContent {
        ToolbarItem(placement: self.placement) {
            OmnipolymathSidebarControlButton(action: self.action)
        }
        // Sidebar reveal is intentionally background-free in every host;
        // suppress the toolbar's automatic glass so it cannot reappear.
        .sharedBackgroundVisibility(.hidden)
    }
}

struct OmnipolymathGlassControlGroup<Content: View>: View {
    @ViewBuilder let content: Content

    var body: some View {
        GlassEffectContainer(spacing: 8) {
            self.content
        }
    }
}

enum OmnipolymathNoticeDetail {
    case accent(String)
    case requestID(String)
}

struct OmnipolymathNoticeBanner: View {
    let icon: String
    let title: OmnipolymathTextValue
    let message: OmnipolymathTextValue
    let ownerLabel: OmnipolymathTextValue
    let tint: Color
    var detail: OmnipolymathNoticeDetail?
    var primaryActionTitle: OmnipolymathTextValue?
    var onPrimaryAction: (() -> Void)?
    var secondaryActionTitle: OmnipolymathTextValue?
    var onSecondaryAction: (() -> Void)?

    var body: some View {
        ProCard(tint: self.tint, padding: 14) {
            VStack(alignment: .leading, spacing: 12) {
                HStack(alignment: .top, spacing: 12) {
                    ProIconBadge(systemName: self.icon, color: self.tint)

                    VStack(alignment: .leading, spacing: 6) {
                        HStack(alignment: .firstTextBaseline, spacing: 8) {
                            self.title.text
                                .font(OmnipolymathType.subheadSemiBold)
                                .multilineTextAlignment(.leading)
                            Spacer(minLength: 0)
                            self.ownerLabel.text
                                .font(OmnipolymathType.captionSemiBold)
                                .foregroundStyle(.secondary)
                        }

                        self.message.text
                            .font(OmnipolymathType.footnote)
                            .foregroundStyle(.secondary)
                            .fixedSize(horizontal: false, vertical: true)

                        self.detailView
                    }
                }

                if self.onPrimaryAction != nil || self.onSecondaryAction != nil {
                    OmnipolymathGlassControlGroup {
                        HStack(spacing: 10) {
                            if let primaryActionTitle, let onPrimaryAction {
                                Button(action: onPrimaryAction) {
                                    primaryActionTitle.text
                                        .font(OmnipolymathType.captionSemiBold)
                                }
                                .font(OmnipolymathType.captionSemiBold)
                                .omnipolymathGlassButton(prominent: true)
                                .controlSize(.small)
                            }
                            if let secondaryActionTitle, let onSecondaryAction {
                                Button(action: onSecondaryAction) {
                                    secondaryActionTitle.text
                                        .font(OmnipolymathType.captionSemiBold)
                                }
                                .font(OmnipolymathType.captionSemiBold)
                                .omnipolymathGlassButton()
                                .controlSize(.small)
                            }
                        }
                    }
                }
            }
        }
    }

    @ViewBuilder
    private var detailView: some View {
        if let detail {
            switch detail {
            case let .accent(value):
                Text(value)
                    .font(OmnipolymathType.captionMedium)
                    .foregroundStyle(self.tint)
                    .fixedSize(horizontal: false, vertical: true)
            case let .requestID(value):
                Text(verbatim: String(
                    format: String(localized: "Request ID: %@"),
                    value))
                    .font(OmnipolymathType.monoSmallMedium)
                    .foregroundStyle(.secondary)
                    .textSelection(.enabled)
            }
        }
    }
}

struct OmnipolymathAdaptiveHeaderRow<Leading: View, Accessory: View>: View {
    let title: OmnipolymathTextValue
    let subtitle: OmnipolymathTextValue?
    var titleFont: Font = OmnipolymathType.title3SemiBold
    var subtitleFont: Font = OmnipolymathType.subhead
    var subtitleLineLimit: Int? = 2
    @ViewBuilder let leading: Leading
    @ViewBuilder let accessory: Accessory

    var body: some View {
        ViewThatFits(in: .horizontal) {
            self.horizontalLayout
            self.stackedLayout
        }
    }

    private var horizontalLayout: some View {
        HStack(alignment: .top, spacing: 12) {
            self.leading

            self.titleBlock
                .layoutPriority(1)

            Spacer(minLength: 8)

            self.accessory
                .fixedSize(horizontal: true, vertical: false)
        }
    }

    private var stackedLayout: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top, spacing: 12) {
                self.leading

                self.titleBlock
                    .layoutPriority(1)

                Spacer(minLength: 8)
            }

            HStack {
                Spacer(minLength: 0)
                self.accessory
                    .fixedSize(horizontal: true, vertical: false)
            }
        }
    }

    private var titleBlock: some View {
        VStack(alignment: .leading, spacing: 4) {
            self.title.text
                .font(self.titleFont)
                .lineLimit(2)
                .minimumScaleFactor(0.86)
                .fixedSize(horizontal: false, vertical: true)
            if let subtitle {
                subtitle.text
                    .font(self.subtitleFont)
                    .foregroundStyle(.secondary)
                    .lineLimit(self.subtitleLineLimit)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }
}

/// Shared switch indicator replacing the 3 duplicated capsule toggles.
/// Native Toggle only hits the switch edge on iOS 26; this full-width button approach
/// gives the whole row a tap target.
struct OmnipolymathToggleIndicator: View {
    let isOn: Bool

    var body: some View {
        Capsule()
            .fill(self.isOn ? OmnipolymathBrand.accentFill : Color.secondary.opacity(0.35))
            .frame(width: 52, height: 32)
            .overlay(alignment: self.isOn ? .trailing : .leading) {
                Circle()
                    .fill(Color.white)
                    .frame(width: 28, height: 28)
                    .padding(2)
                    .shadow(color: Color.black.opacity(0.14), radius: 1, x: 0, y: 1)
            }
    }
}

enum OmnipolymathStatusTone {
    case ok
    case warn
    case accent
    case muted

    var color: Color {
        switch self {
        case .ok: OmnipolymathBrand.ok
        case .warn: OmnipolymathBrand.warn
        case .accent: OmnipolymathBrand.accent
        case .muted: OmnipolymathBrand.textSecondary
        }
    }
}

struct OmnipolymathStatusBadge: View {
    @Environment(\.colorScheme) private var colorScheme
    let label: OmnipolymathTextValue
    let tone: OmnipolymathStatusTone

    var body: some View {
        HStack(spacing: 6) {
            Circle()
                .fill(self.tone.color)
                .frame(width: 7, height: 7)
                .shadow(color: self.tone.color.opacity(0.55), radius: 3)
            self.label.text
                .font(OmnipolymathType.caption2SemiBold)
                .foregroundStyle(self.tone.color)
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 5)
        .background {
            Capsule()
                .fill(self.tone.color.opacity(self.colorScheme == .dark ? 0.14 : 0.10))
        }
    }
}

struct OmnipolymathProMark: View {
    var size: CGFloat = 42
    var shadowRadius: CGFloat = 10
    /// Opt-in tap Easter eggs; leave off when the mark sits inside a control.
    var interactive = false
    var paused = false

    var body: some View {
        OmnipolymathMascotView(interactive: self.interactive, paused: self.paused)
            .frame(width: self.size, height: self.size)
            .shadow(color: OmnipolymathBrand.accent.opacity(0.18), radius: self.shadowRadius, y: self.shadowRadius / 3)
            .accessibilityLabel("Omnipolymath")
    }
}

struct OmnipolymathGatewayCompactPill: View {
    @Environment(NodeAppModel.self) private var appModel

    var body: some View {
        let presentation = GatewayStatusBuilder.build(appModel: self.appModel).statusPresentation
        OmnipolymathStatusBadge(label: .verbatim(presentation.title), tone: presentation.tone)
            .accessibilityLabel(
                String(
                    format: String(localized: "Gateway %@"),
                    presentation.title))
    }
}

extension GatewayDisplayState {
    var statusPresentation: (title: String, tone: OmnipolymathStatusTone) {
        switch self {
        case .connected:
            (String(localized: "Online"), .ok)
        case .connecting:
            (String(localized: "Connecting"), .accent)
        case .error:
            (String(localized: "Attention"), .warn)
        case .disconnected:
            (String(localized: "Offline"), .muted)
        }
    }
}
