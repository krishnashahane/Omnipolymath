import { createPluginInstallOwnerMetadata } from "./candidate-install-owner.js";

export const {
  record: recordPluginManifestInstallOwner,
  resolve: resolvePluginManifestInstallOwner,
  isAmbiguous: isPluginManifestInstallOwnerAmbiguous,
} = createPluginInstallOwnerMetadata("omnipolymath.pluginManifestInstallOwner", false);
