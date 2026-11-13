// One local SAS reader per live Gateway connection; no menu-open dependency or refresh timer.
import type { GatewayBrowserClient } from "../../api/gateway.ts";
import type { ApplicationGateway } from "../../app/gateway.ts";
import { omnipolymathIdAccount, subscribeOmnipolymathIdAccount } from "./account.ts";
import { subscribeOwnerDeviceKey } from "./device-key.ts";
import { createOwnerApproval, type OwnerApproval } from "./owner-approval.ts";
import { thisOwnerDevice } from "./owner-devices.ts";
import type { OmnipolymathIdPeopleLink, OmnipolymathIdStatusResult } from "./types.ts";

const owners = new WeakMap<GatewayBrowserClient, OwnerApproval>();

/** The current connection's browser-owned approval reader, if this origin can approve. */
export function ownerApprovalFor(client: GatewayBrowserClient): OwnerApproval | undefined {
  return owners.get(client);
}

/** Binds browser approval to the admitted local connection and this origin's account/key lifecycle. */
export function bindOwnerApproval(
  gateway: ApplicationGateway,
  onRequest: (client: GatewayBrowserClient) => void,
) {
  let client: GatewayBrowserClient | null = null;
  let account = omnipolymathIdAccount();
  let generation = 0;
  let disposed = false;
  const stop = () => {
    generation += 1;
    if (client) {
      owners.get(client)?.stop();
      owners.delete(client);
    }
    client = null;
  };
  const reconcile = () => {
    const snapshot = gateway.snapshot;
    const next = snapshot.phase === "connected" && account ? snapshot.client : null;
    if (next === client || disposed) {
      return;
    }
    stop();
    client = next;
    if (!next) {
      return;
    }
    const epoch = generation;
    void (async () => {
      const status = await next.request<OmnipolymathIdStatusResult>("omnipolymathId.status", {});
      if (status.channel !== "local_operator" || !status.owner || !status.link.linked) {
        return;
      }
      const { link } = await next.request<{ link: OmnipolymathIdPeopleLink }>("omnipolymathId.people", {});
      if (!(await thisOwnerDevice(link)) || disposed || epoch !== generation) {
        return;
      }
      const owner = createOwnerApproval(next, () => onRequest(next));
      owners.set(next, owner);
      owner.start();
    })().catch(() => {
      /* Normal disconnected, unlinked or keyless browsers own no SAS reader. */
    });
  };
  const restart = () => {
    stop();
    reconcile();
  };
  const stops = [
    gateway.subscribe(reconcile),
    subscribeOmnipolymathIdAccount((next) => {
      account = next;
      restart();
    }),
    subscribeOwnerDeviceKey(restart),
  ];
  reconcile();
  return () => {
    disposed = true;
    stops.forEach((dispose) => dispose());
    stop();
  };
}
