import { createEffect, createMemo } from "solid-js";
import { useApplication } from "../../lib/reactive/context.ts";
import { createAgentsPageState } from "./agents-page-state.ts";
import type { AgentsRouteData } from "./route.ts";
import { Agents } from "./view.tsx";

export function AgentsPage(props: { routeData?: AgentsRouteData }) {
  const context = useApplication();
  const state = createAgentsPageState(context);
  // Route receipts retarget requests before the owner starts at settle.
  createEffect(
    () => props.routeData,
    (routeData) => state.setRouteData(routeData),
  );
  const viewProps = createMemo(() => ({
    ...state.read(),
  }));
  return (
    <omnipolymath-agents-page>
      <Agents {...viewProps()} />
    </omnipolymath-agents-page>
  );
}

declare module "@solidjs/web" {
  namespace JSX {
    interface IntrinsicElements {
      "omnipolymath-agents-page": HTMLAttributes<HTMLElement>;
    }
  }
}
