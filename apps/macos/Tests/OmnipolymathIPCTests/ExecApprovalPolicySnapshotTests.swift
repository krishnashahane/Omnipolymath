import Foundation
import OmnipolymathKit
import Testing
@testable import Omnipolymath

struct ExecApprovalPolicySnapshotTests {
    @Test
    func `portable snapshot import preserves canonical policy semantics`() {
        let snapshot = ExecApprovalPolicySnapshot(
            security: .allowlist,
            ask: .onMiss,
            askFallback: .deny,
            autoAllowSkills: true,
            allowlist: [
                ExecAllowlistEntry(pattern: "/usr/bin/tool", source: "legacy"),
                ExecAllowlistEntry(
                    pattern: "/usr/bin/tool",
                    source: "allow-always",
                    argPattern: "^ok$"),
            ])

        let portable = OmnipolymathSystemRunApprovalPolicySnapshot(
            security: .allowlist,
            ask: .onMiss,
            askFallback: .deny,
            autoAllowSkills: true,
            allowlistRules: [
                OmnipolymathSystemRunApprovalPolicySnapshot.Rule(pattern: "/usr/bin/tool"),
                OmnipolymathSystemRunApprovalPolicySnapshot.Rule(
                    pattern: "/usr/bin/tool",
                    argPattern: "^ok$",
                    source: .allowAlways),
            ])
        #expect(snapshot == ExecApprovalPolicySnapshot(portable: portable))
    }

    @Test
    func `portable snapshot decode deduplicates and sorts rules by utf8 bytes`() throws {
        let data = Data(#"""
        {
          "security": "allowlist",
          "ask": "on-miss",
          "askFallback": "deny",
          "autoAllowSkills": false,
          "allowlistRules": [
            {"pattern": "/ä"},
            {"pattern": "/A", "source": "allow-always"},
            {"pattern": "/", "argPattern": "é"},
            {"pattern": "/"},
            {"pattern": "/", "argPattern": "A"},
            {"pattern": "/"},
            {"pattern": "/A"},
            {"pattern": "/é"},
            {"pattern": "/e\u0301"}
          ]
        }
        """#.utf8)

        let portable = try JSONDecoder().decode(
            OmnipolymathSystemRunApprovalPolicySnapshot.self,
            from: data)

        #expect(portable.allowlistRules == [
            OmnipolymathSystemRunApprovalPolicySnapshot.Rule(pattern: "/"),
            OmnipolymathSystemRunApprovalPolicySnapshot.Rule(pattern: "/", argPattern: "A"),
            OmnipolymathSystemRunApprovalPolicySnapshot.Rule(pattern: "/", argPattern: "é"),
            OmnipolymathSystemRunApprovalPolicySnapshot.Rule(pattern: "/A"),
            OmnipolymathSystemRunApprovalPolicySnapshot.Rule(pattern: "/A", source: .allowAlways),
            OmnipolymathSystemRunApprovalPolicySnapshot.Rule(pattern: "/e\u{0301}"),
            OmnipolymathSystemRunApprovalPolicySnapshot.Rule(pattern: "/ä"),
            OmnipolymathSystemRunApprovalPolicySnapshot.Rule(pattern: "/é"),
        ])
        #expect(ExecApprovalPolicySnapshot(portable: portable) == ExecApprovalPolicySnapshot(
            security: .allowlist,
            ask: .onMiss,
            askFallback: .deny,
            autoAllowSkills: false,
            allowlist: [
                ExecAllowlistEntry(pattern: "/"),
                ExecAllowlistEntry(pattern: "/", argPattern: "A"),
                ExecAllowlistEntry(pattern: "/", argPattern: "é"),
                ExecAllowlistEntry(pattern: "/A"),
                ExecAllowlistEntry(pattern: "/A", source: "allow-always"),
                ExecAllowlistEntry(pattern: "/e\u{0301}"),
                ExecAllowlistEntry(pattern: "/ä"),
                ExecAllowlistEntry(pattern: "/é"),
            ]))
    }
}
