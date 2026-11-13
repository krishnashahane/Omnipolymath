import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  isLegacyRollingLogFilePath,
  isSameRollingLogFileFamily,
  resolveConfiguredLogFilePath,
  resolveRollingLogFilePathForDate,
} from "./log-file-path.js";

const date = new Date(2026, 6, 22, 12, 0, 0);

describe("resolveConfiguredLogFilePath", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(date);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  const resolveForProfile = (profile?: string) => {
    vi.stubEnv("OMNIPOLYMATH_PROFILE", profile);
    return resolveConfiguredLogFilePath();
  };

  it.each([
    [undefined, "omnipolymath"],
    ["Default", "omnipolymath"],
    ["dev", "omnipolymath-dev"],
    ["QA_Profile", "omnipolymath--1q-1a-0-1profile"],
  ])("uses the %s profile filename", (profile, prefix) => {
    expect(path.basename(resolveForProfile(profile))).toBe(`${prefix}-2026-07-22.log`);
  });

  it.each([
    ["qa-profile", "omnipolymath-qa--profile-2026-07-22.log"],
    ["-1q-1a-0-1profile", undefined],
  ])("keeps QA_Profile distinct from %s", (profile, expected) => {
    const other = resolveForProfile(profile);
    expect(resolveForProfile("QA_Profile")).not.toBe(other);
    if (expected) {
      expect(path.basename(other)).toBe(expected);
    }
  });

  it("bounds direct environment profiles that exceed the CLI length contract", () => {
    const first = resolveForProfile("A".repeat(80));
    const second = resolveForProfile("B".repeat(80));

    expect(path.basename(first)).toMatch(/^omnipolymath--3[a-f0-9]{64}-2026-07-22\.log$/u);
    expect(path.basename(first).length).toBeLessThanOrEqual(255);
    expect(first).not.toBe(second);
  });

  it("preserves an explicit logging.file override", () => {
    vi.stubEnv("OMNIPOLYMATH_PROFILE", "dev");
    expect(
      resolveConfiguredLogFilePath({ logging: { file: "/var/log/omnipolymath/custom.log" } }),
    ).toBe("/var/log/omnipolymath/custom.log");
  });
});

it.each([
  ["omnipolymath-dev-2026-07-22.log", "omnipolymath-dev-2026-07-23.log"],
  ["omnipolymath-YYYY-MM-DD.log", "omnipolymath-2026-07-23.log"],
])("advances %s while preserving its family", (before, after) => {
  expect(
    resolveRollingLogFilePathForDate(`/tmp/omnipolymath/${before}`, new Date(2026, 6, 23, 12)),
  ).toBe(`/tmp/omnipolymath/${after}`);
});

it("keeps default and named profile fallback families separate", () => {
  expect(
    isSameRollingLogFileFamily("omnipolymath-dev-2026-07-22.log", "omnipolymath-dev-2026-07-21.log"),
  ).toBe(true);
  expect(isSameRollingLogFileFamily("omnipolymath-dev-2026-07-22.log", "omnipolymath-2026-07-22.log")).toBe(
    false,
  );
});

it("keeps legacy explicit dated paths rolling without broadening the override contract", () => {
  expect(isLegacyRollingLogFilePath("omnipolymath-2026-07-22.log")).toBe(true);
  expect(isLegacyRollingLogFilePath("omnipolymath-YYYY-MM-DD.log")).toBe(true);
  expect(isLegacyRollingLogFilePath("omnipolymath-dev-2026-07-22.log")).toBe(false);
  expect(isLegacyRollingLogFilePath("omnipolymath-configured.log")).toBe(false);
});
