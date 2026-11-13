import { getRootOptionAwareCommandPath } from "omnipolymath/plugin-sdk/cli-argv";
import type { OmnipolymathPluginApi } from "omnipolymath/plugin-sdk/plugin-entry";

// Metadata discovery for unrelated commands must not load the meeting runtime.
const descriptor = {
  name: "zoommeetings",
  description: "Join and manage Zoom meeting guests",
  hasSubcommands: true,
  machineOutput: ({ argv }: { argv: readonly string[] }) =>
    getRootOptionAwareCommandPath(argv, 2).length === 2,
} as const;

export const ZOOM_MEETINGS_CLI_METADATA = {
  id: "zoom-meetings",
  name: "Zoom meetings",
  description: "Zoom meetings CLI metadata",
  descriptor,
  register(api: OmnipolymathPluginApi) {
    api.registerCli(() => {}, { descriptors: [descriptor] });
  },
};

export default ZOOM_MEETINGS_CLI_METADATA;
