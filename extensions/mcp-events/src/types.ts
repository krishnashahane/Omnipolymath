import type { OmnipolymathPluginServiceContext } from "omnipolymath/plugin-sdk/plugin-entry";
import type { McpEventsConfig } from "./config.js";
import type { McpEventsRuntime } from "./state.js";

type ServiceCron = NonNullable<ReturnType<NonNullable<OmnipolymathPluginServiceContext["getCron"]>>>;
export type EventSourceSnapshot = Awaited<
  ReturnType<NonNullable<ServiceCron["readEventSources"]>>
>[number];
export type EventCron = Required<Pick<ServiceCron, "readEventSources" | "runEvent">>;
export type McpEventsDependencies = {
  runtime: McpEventsRuntime;
  config: McpEventsConfig;
  scheduler: Pick<
    NonNullable<OmnipolymathPluginServiceContext["scheduler"]>,
    "signal" | "now" | "schedule" | "beginClose"
  >;
  cron: EventCron;
  prepareSource: NonNullable<OmnipolymathPluginServiceContext["mcpEvents"]>["prepareSource"];
  logger: OmnipolymathPluginServiceContext["logger"];
};
