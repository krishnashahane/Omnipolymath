import {
  openOmnipolymathStateDatabase,
  runOmnipolymathStateWriteTransaction,
} from "../state/omnipolymath-state-db.js";
import {
  readChannelPairingSnapshotFromDatabase,
  writeChannelPairingStateToDatabase,
} from "./pairing-store-sqlite.js";
import type { PairingChannel } from "./pairing-store.types.js";

type ChannelPairingState = ReturnType<typeof readChannelPairingSnapshotFromDatabase>["state"];

export function readChannelPairingStateSnapshot(
  channel: PairingChannel,
  env: NodeJS.ProcessEnv = process.env,
): ChannelPairingState {
  return readChannelPairingSnapshotFromDatabase(openOmnipolymathStateDatabase({ env }), channel).state;
}

export function writeChannelPairingStateSnapshot(
  channel: PairingChannel,
  state: ChannelPairingState,
  env: NodeJS.ProcessEnv = process.env,
): void {
  runOmnipolymathStateWriteTransaction(
    (database) => writeChannelPairingStateToDatabase(database, channel, state),
    { env },
  );
}
