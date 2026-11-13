import OmnipolymathChatUI
import OmnipolymathKit
import SwiftUI

struct CommandSessionRow: View {
    let item: CommandCenterTab.WorkItem

    var body: some View {
        HStack(alignment: .center, spacing: 12) {
            Image(systemName: self.item.icon)
                .font(OmnipolymathType.captionSemiBold)
                .foregroundStyle(self.item.color)
                .frame(width: 30, height: 30)
                .background {
                    RoundedRectangle(cornerRadius: OmnipolymathRadius.sm, style: .continuous)
                        .fill(self.item.color.opacity(0.12))
                }
            VStack(alignment: .leading, spacing: 4) {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    if self.item.isUnread {
                        Circle()
                            .fill(OmnipolymathBrand.accent)
                            .frame(width: 7, height: 7)
                            .accessibilityHidden(true)
                    }
                    Text(verbatim: self.item.title)
                        .font(OmnipolymathType.subheadSemiBold)
                        .lineLimit(1)
                        .minimumScaleFactor(0.82)
                    Spacer(minLength: 6)
                    if self.item.isPinned {
                        Image(systemName: "pin.fill")
                            .font(OmnipolymathType.caption2Medium)
                            .foregroundStyle(OmnipolymathBrand.accent)
                            .accessibilityHidden(true)
                    }
                    Text(verbatim: "chat")
                        .font(OmnipolymathType.caption2Medium)
                        .foregroundStyle(.secondary)
                }
                HStack(spacing: 8) {
                    Text(verbatim: self.item.detail)
                        .font(OmnipolymathType.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                    Spacer(minLength: 6)
                    Text(self.stateLabel)
                        .font(OmnipolymathType.captionSemiBold)
                        .foregroundStyle(self.item.color)
                        .lineLimit(1)
                        .frame(width: 48, alignment: .trailing)
                }
            }
        }
        .padding(.horizontal, 4)
        .padding(.vertical, 6)
        .overlay(alignment: .leading) {
            OmnipolymathSessionColorStripe(color: self.item.sessionColor)
        }
        .contentShape(Rectangle())
    }

    private var stateLabel: String {
        switch self.item.state {
        case "open": String(localized: "open")
        case "default": String(localized: "default")
        case "recent": String(localized: "recent")
        default: self.item.state
        }
    }
}

struct CommandSessionActionsModifier: ViewModifier {
    typealias Mutation = (any OmnipolymathChatTransport) async throws -> Void

    private enum Editor {
        case rename
        case newGroup
    }

    let session: OmnipolymathChatSessionEntry
    let mainSessionKey: String
    let categories: [String]
    let isArchived: Bool
    let isEnabled: Bool
    let canArchive: Bool
    let canDelete: Bool
    let archivesSession: () -> Bool
    let performMutation: (String?, @escaping Mutation) -> Void
    let fork: () -> Void

    @State private var editor: Editor?
    @State private var draftText = ""
    @State private var confirmsDelete = false

    func body(content: Content) -> some View {
        if self.isEnabled {
            self.managedContent(content)
        } else {
            content
        }
    }

    private func managedContent(_ content: Content) -> some View {
        content
            .contextMenu {
                OmnipolymathSessionColorMenu(color: self.session.color) {
                    self.patch(color: .some($0))
                }
                if !self.isArchived {
                    self.actionButton(
                        self.session.pinned == true
                            ? OmnipolymathTextValue.localized("Unpin")
                            : OmnipolymathTextValue.localized("Pin"),
                        systemImage: self.session.pinned == true ? "pin.slash" : "pin")
                    {
                        self.patch(pinned: self.session.pinned != true)
                    }
                    if self.canSnooze {
                        self.snoozeMenu
                    }
                    self.actionButton(
                        self.session.unread == true
                            ? OmnipolymathTextValue.localized("Mark as Read")
                            : OmnipolymathTextValue.localized("Mark as Unread"),
                        systemImage: self.session.unread == true ? "envelope.open" : "envelope.badge")
                    {
                        self.patch(unread: self.session.unread != true)
                    }
                    self.actionButton("Rename…", systemImage: "pencil") {
                        self.beginRename()
                    }
                    self.actionButton(
                        self.session.hasActiveRun == true
                            ? OmnipolymathTextValue.localized("Fork from last completed message")
                            : OmnipolymathTextValue.localized("Fork"),
                        systemImage: "arrow.triangle.branch")
                    {
                        self.fork()
                    }
                    self.groupMenu
                }
                if self.canArchive {
                    self.actionButton(
                        self.isArchived ? .localized("Unarchive") : .localized("Archive"),
                        systemImage: "archivebox")
                    {
                        self.patch(archived: self.archivesSession())
                    }
                }
                if self.canDelete {
                    self.deleteButton
                }
            }
            .alert(self.editorTitle, isPresented: self.editorBinding) {
                TextField(self.editorPlaceholder, text: self.$draftText)
                    .font(OmnipolymathType.body)
                Button {
                    self.commitEditor()
                } label: {
                    Text(self.editor == .rename
                        ? LocalizedStringKey("Save")
                        : LocalizedStringKey("Create"))
                        .font(OmnipolymathType.subheadSemiBold)
                }
                Button(role: .cancel) {
                    self.editor = nil
                } label: {
                    Text("Cancel")
                        .font(OmnipolymathType.subheadSemiBold)
                }
            }
            .confirmationDialog(
                "Delete Session?",
                isPresented: self.$confirmsDelete,
                titleVisibility: .visible)
            {
                Button(role: .destructive) {
                    self.performMutation(self.session.key) { transport in
                        try await transport.deleteSession(key: self.session.key)
                    }
                } label: {
                    Text("Delete Session")
                        .font(OmnipolymathType.subheadSemiBold)
                }
                Button(role: .cancel) {} label: {
                    Text("Cancel")
                        .font(OmnipolymathType.subheadSemiBold)
                }
            } message: {
                Text("This permanently deletes the session and its transcript.")
                    .font(OmnipolymathType.caption)
            }
    }

    private func patch(
        label: String?? = nil,
        category: String?? = nil,
        color: String?? = nil,
        pinned: Bool? = nil,
        archived: Bool? = nil,
        unread: Bool? = nil)
    {
        self.performMutation(archived == true ? self.session.key : nil) { transport in
            try await transport.patchSession(
                key: self.session.key,
                expectedSessionID: archived == nil ? nil : self.session.sessionId,
                label: label,
                category: category,
                color: color,
                pinned: pinned,
                archived: archived,
                unread: unread)
        }
    }

    private func patchSnooze(_ snoozedUntil: OmnipolymathChatSnoozePatch) {
        self.performMutation(nil) { transport in
            try await transport.patchSession(
                key: self.session.key,
                expectedSessionID: self.session.sessionId,
                snoozedUntil: snoozedUntil)
        }
    }

    private var canSnooze: Bool {
        let key = self.session.key.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let agentID = OmnipolymathChatSessionKey.agentID(from: key)
        let sessionName = agentID == nil
            ? key
            : String(key.split(separator: ":", maxSplits: 2, omittingEmptySubsequences: false)[2])
        let mainKey = self.mainSessionKey.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let configuredMain = OmnipolymathChatSessionKey.agentID(from: mainKey) == nil
            ? mainKey
            : String(mainKey.split(separator: ":", maxSplits: 2, omittingEmptySubsequences: false)[2])
        guard !self.isArchived, !self.session.isArchived, self.session.isMain != true,
              self.session.sessionId?.trimmedNonEmpty != nil,
              self.session.kind != "global", self.session.kind != "unknown",
              key != "main", key != "global", key != "unknown", sessionName != configuredMain,
              !sessionName.hasPrefix("subagent:"), self.session.spawnedBy?.trimmedNonEmpty == nil
        else { return false }
        guard let parent = self.session.parentSessionKey?.trimmedNonEmpty else { return true }
        // Ordinary dashboard conversations link to Home without becoming nested children.
        return agentID.map { parent == "agent:\($0):main" } ?? false
    }

    @ViewBuilder
    private var snoozeMenu: some View {
        let now = Date.now
        if self.session.isSnoozed(at: now), let snoozedUntil = self.session.snoozedUntil {
            let wakeDescription = OmnipolymathChatSessionSnooze.wakeDescription(
                Date(timeIntervalSince1970: snoozedUntil / 1000),
                now: now)
            self.actionButton(
                .verbatim(String(format: String(localized: "Wake session · %@"), wakeDescription)),
                systemImage: "clock")
            {
                self.patchSnooze(.wake)
            }
        } else {
            Menu {
                ForEach(OmnipolymathChatSessionSnooze.presets(now: now), id: \.id) { preset in
                    // "Next week" needs its weekday; the other titles already name the day.
                    let when = preset.id == "next-week"
                        ? OmnipolymathChatSessionSnooze.wakeDescription(preset.wakeAt, now: now)
                        : preset.wakeAt.formatted(date: .omitted, time: .shortened)
                    self.actionButton(.verbatim("\(preset.title) · \(when)"), systemImage: "clock") {
                        self.patchSnooze(.until(preset.wakeAt))
                    }
                }
            } label: {
                Label("Snooze", systemImage: "clock")
                    .font(OmnipolymathType.subhead)
            }
        }
    }

    private var groupMenu: some View {
        Menu {
            ForEach(self.categories, id: \.self) { category in
                self.actionButton(.verbatim(category), systemImage: "folder") {
                    self.patch(category: .some(category))
                }
            }
            self.actionButton("New Group…", systemImage: "folder.badge.plus") {
                self.draftText = ""
                self.editor = .newGroup
            }
            if self.session.category?.trimmedNonEmpty != nil {
                self.actionButton("Remove from Group", systemImage: "folder.badge.minus") {
                    self.patch(category: .some(nil))
                }
            }
        } label: {
            Label("Move to Group", systemImage: "folder")
                .font(OmnipolymathType.subhead)
        }
    }

    private var deleteButton: some View {
        Button(role: .destructive) {
            self.confirmsDelete = true
        } label: {
            Label("Delete…", systemImage: "trash")
                .font(OmnipolymathType.subhead)
        }
    }

    private var editorBinding: Binding<Bool> {
        Binding(
            get: { self.editor != nil },
            set: { if !$0 { self.editor = nil } })
    }

    private var editorTitle: String {
        self.editor == .newGroup
            ? String(localized: "New Group")
            : String(localized: "Rename Session")
    }

    private var editorPlaceholder: String {
        self.editor == .newGroup
            ? String(localized: "Group name")
            : String(localized: "Session name")
    }

    private func actionButton(
        _ title: OmnipolymathTextValue,
        systemImage: String,
        action: @escaping () -> Void) -> some View
    {
        Button(action: action) {
            Label {
                title.text
                    .font(OmnipolymathType.subhead)
            } icon: {
                Image(systemName: systemImage)
            }
        }
    }

    private func beginRename() {
        self.draftText = self.session.label?.trimmedNonEmpty
            ?? self.session.displayName?.trimmedNonEmpty
            ?? ""
        self.editor = .rename
    }

    private func commitEditor() {
        let value = self.draftText.trimmedNonEmpty
        switch self.editor {
        case .rename:
            self.patch(label: .some(value))
        case .newGroup:
            if let value {
                // Web parity: only prompt-created groups join the stored list,
                // so they survive as empty sections after members leave.
                SessionGroupStore.remember(value)
                self.patch(category: .some(value))
            }
        case nil:
            break
        }
        self.editor = nil
    }
}

extension View {
    func commandSessionActions(
        session: OmnipolymathChatSessionEntry,
        mainSessionKey: String = "main",
        categories: [String],
        isArchived: Bool = false,
        isEnabled: Bool = true,
        canArchive: Bool = true,
        canDelete: Bool = true,
        archivesSession: @escaping () -> Bool = { true },
        performMutation: @escaping (String?, @escaping CommandSessionActionsModifier.Mutation) -> Void,
        fork: @escaping () -> Void) -> some View
    {
        self.modifier(CommandSessionActionsModifier(
            session: session,
            mainSessionKey: mainSessionKey,
            categories: categories,
            isArchived: isArchived,
            isEnabled: isEnabled,
            canArchive: canArchive,
            canDelete: canDelete,
            archivesSession: archivesSession,
            performMutation: performMutation,
            fork: fork))
    }
}

struct CommandEmptyStateRow: View {
    let icon: String
    let title: OmnipolymathTextValue
    let detail: OmnipolymathTextValue

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: self.icon)
                .font(OmnipolymathType.captionBold)
                .foregroundStyle(OmnipolymathBrand.ok)
                .frame(width: 30, height: 30)
                .background {
                    RoundedRectangle(cornerRadius: OmnipolymathRadius.xs, style: .continuous)
                        .fill(OmnipolymathBrand.ok.opacity(0.10))
                }
            VStack(alignment: .leading, spacing: 2) {
                self.title.text
                    .font(OmnipolymathType.subheadSemiBold)
                    .lineLimit(1)
                self.detail.text
                    .font(OmnipolymathType.caption2Medium)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 4)
        .padding(.vertical, 6)
    }
}
