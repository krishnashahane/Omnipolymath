import { expect, it } from "vitest";
import type { StaleOmnipolymathUpdateLaunchdJob } from "../../daemon/launchd.js";
import { withMockedPlatform } from "../../test-utils/vitest-spies.js";

export const staleUpdateLaunchdJobsFixture: StaleOmnipolymathUpdateLaunchdJob[] = [
  { label: "ai.omnipolymath.update.2026.5.12", lastExitStatus: 127 },
  { label: "ai.omnipolymath.manual-update.1717168800", lastExitStatus: 0 },
];

type ScanStatus = {
  service: {
    staleUpdateLaunchdJobs?: readonly StaleOmnipolymathUpdateLaunchdJob[];
    staleLaunchdInspectionError?: string;
  };
};

export function registerStatusLaunchdScanTests(params: {
  gatherStatus: (deep: boolean) => Promise<ScanStatus>;
  setServiceCommand: () => void;
  setStaleScan: (scanFails: boolean, jobs: typeof staleUpdateLaunchdJobsFixture) => void;
  staleScanEnv: () => NodeJS.ProcessEnv | undefined;
}) {
  it.each([
    { label: "jobs", scanFails: false },
    { label: "scan failure", scanFails: true },
  ])("surfaces stale updater $label during deep status", ({ scanFails }) =>
    withMockedPlatform("darwin", async () => {
      params.setServiceCommand();
      params.setStaleScan(scanFails, staleUpdateLaunchdJobsFixture);
      const status = await params.gatherStatus(true);
      expect(params.staleScanEnv()).toMatchObject({
        OMNIPOLYMATH_STATE_DIR: "/tmp/omnipolymath-daemon",
        OMNIPOLYMATH_CONFIG_PATH: "/tmp/omnipolymath-daemon/omnipolymath.json",
        OMNIPOLYMATH_LAUNCHD_LABEL: "ai.omnipolymath.manual-update.gateway",
      });
      expect(status.service.staleUpdateLaunchdJobs).toEqual(
        scanFails ? undefined : staleUpdateLaunchdJobsFixture,
      );
      expect(status.service.staleLaunchdInspectionError).toEqual(
        scanFails ? expect.stringContaining("launchctl list failed") : undefined,
      );
    }),
  );
}
