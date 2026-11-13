#!/usr/bin/env -S node --import tsx
import { pathToFileURL } from "node:url";
import {
  buildOmnipolymathReleaseClawHubPlan,
  parseOmnipolymathReleaseClawHubPlanArgs,
} from "./lib/omnipolymath-release-clawhub-plan.ts";

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const args = parseOmnipolymathReleaseClawHubPlanArgs(process.argv.slice(2));
  const plan = await buildOmnipolymathReleaseClawHubPlan(args);
  console.log(JSON.stringify(plan, null, 2));
}
