import OmnipolymathKit
import OmnipolymathProtocol
import SwiftUI

extension AgentProTab {
    @ViewBuilder
    func destination(for route: AgentRoute) -> some View {
        switch route {
        case .agents:
            self.agentsDestination
        case .files:
            AgentWorkspaceFilesScreen(
                agentId: self.activeAgentID,
                headerSidebarAction: self.headerSidebarAction)
        }
    }

    var agentsDestination: some View {
        List {
            Section {
                if self.filteredAgents.isEmpty {
                    self.emptyAgentsRow
                } else {
                    ForEach(self.filteredAgents, id: \.id) { agent in
                        self.agentRow(agent)
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle(self.headerTitle)
        .navigationBarTitleDisplayMode(.large)
        .searchable(text: self.$agentSearchText, prompt: "Search agents")
        .refreshable {
            await self.refreshAgents()
        }
        .font(OmnipolymathType.body)
        .toolbar {
            ToolbarItemGroup(placement: .topBarTrailing) {
                self.agentFilterMenu
                self.gatewayToolbarButton
            }
            if let headerSidebarAction {
                OmnipolymathSidebarToolbarItem(
                    action: headerSidebarAction,
                    placement: .topBarLeading)
            }
        }
    }
}
