// The bundled handler and diagnostics read the same declared extra files.
import { resolveExtraBootstrapPatterns } from "../../../agents/workspace-bootstrap-policy.js";
import { loadExtraBootstrapFilesWithDiagnostics } from "../../../agents/workspace.js";
import type { OmnipolymathConfig } from "../../../config/types.omnipolymath.js";
export async function loadDeclaredExtraBootstrapFiles(params: {
  config: OmnipolymathConfig | undefined;
  workspaceDir: string;
}): ReturnType<typeof loadExtraBootstrapFilesWithDiagnostics> {
  const patterns = resolveExtraBootstrapPatterns(params.config);
  if (patterns.length === 0) {
    return { files: [], diagnostics: [] };
  }
  return loadExtraBootstrapFilesWithDiagnostics(params.workspaceDir, patterns);
}
