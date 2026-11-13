import { isIrohEndpointKey } from "../../../packages/omnipolymath-id-protocol/src/index.js";
import type { OmnipolymathIdAuthority } from "./authority.js";
import { clawOriginOfRecord, setOmnipolymathIdClawOriginResolver } from "./claw-origin.js";
import {
  setOmnipolymathIdTunnelPrincipalLookup,
  setOmnipolymathIdNodeDescriptionLookup,
  setOmnipolymathIdTunnelActivityRecorder,
  setOmnipolymathIdTunnelPrincipalResolver,
} from "./tunnel-principal.js";

/** Publishes local device authority independently of relay or Discovery availability. */
export function createTunnelPrincipalPublisher(params: {
  authority: () => Promise<OmnipolymathIdAuthority>;
  current: () => OmnipolymathIdAuthority | undefined;
  enabled: () => boolean;
  warn: (message: string) => void;
}) {
  return {
    publish(): void {
      if (!params.enabled()) {
        return;
      }
      setOmnipolymathIdTunnelPrincipalResolver(async (peerKey) => {
        const owner = await params.authority();
        if (!params.enabled()) {
          return undefined;
        }
        const principal = await owner.resolvePeer(peerKey);
        if (principal) {
          void owner
            .recordSeen(peerKey)
            .catch((error: unknown) =>
              params.warn(`omnipolymath-id: could not record device activity: ${String(error)}`),
            );
        }
        return principal;
      });
      setOmnipolymathIdTunnelPrincipalLookup(
        (peerKey) => (params.enabled() ? params.current()?.currentPeer(peerKey) : undefined),
        async () => {
          if (params.enabled()) {
            await params.authority();
          }
        },
      );
      setOmnipolymathIdNodeDescriptionLookup((peerKey) =>
        params.enabled() && isIrohEndpointKey(peerKey)
          ? params.current()?.current()?.authority?.nodes[peerKey]?.description
          : undefined,
      );
      setOmnipolymathIdTunnelActivityRecorder((peerKey) => {
        if (params.enabled()) {
          void params
            .current()
            ?.recordSeen(peerKey)
            .catch((error: unknown) =>
              params.warn(`omnipolymath-id: could not record device activity: ${String(error)}`),
            );
        }
      });
      setOmnipolymathIdClawOriginResolver(() =>
        params.enabled() ? clawOriginOfRecord(params.current()?.current()) : undefined,
      );
    },
    stop(): void {
      setOmnipolymathIdNodeDescriptionLookup(undefined);
      setOmnipolymathIdTunnelActivityRecorder(undefined);
      setOmnipolymathIdTunnelPrincipalResolver(undefined);
      setOmnipolymathIdTunnelPrincipalLookup(undefined);
      setOmnipolymathIdClawOriginResolver(undefined);
    },
  };
}
