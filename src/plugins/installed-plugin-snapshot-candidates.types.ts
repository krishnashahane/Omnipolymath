import type { OmnipolymathStateLeaseIdentity } from "../state/omnipolymath-state-lease.types.js";
import type { PluginSourceSnapshotDescriptor } from "./plugin-source-snapshot.types.js";

export type PluginSnapshotCandidateOperation = {
  "plugins.metadata.index.snapshotCandidates": {
    input: {
      identity: OmnipolymathStateLeaseIdentity;
      operation: "read" | "retain" | "release";
      candidates: PluginSourceSnapshotDescriptor[];
    };
    output: PluginSourceSnapshotDescriptor[];
  };
};
