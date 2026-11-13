import path from "node:path";
import { expect, it } from "vitest";
import { resolveStateDir } from "../config/state-dir.js";
import { withMockedPlatform } from "../test-utils/vitest-spies.js";
import {
  mergeGatewayServiceEnv,
  resolveWindowsServiceCommandProfile,
} from "./service-env-merge.js";
import type { GatewayServiceCommandConfig } from "./service-types.js";

const saved = { OMNIPOLYMATH_PROFILE: "saved" };
it.each(["darwin", "linux", "win32"] as const)(
  "keeps caller state selectors out of installed payloads on %s",
  (platform) =>
    withMockedPlatform(platform, () => {
      const home = path.resolve("service-home");
      const caller = {
        HOME: home,
        OMNIPOLYMATH_HOME: path.join(home, "caller-home"),
        OMNIPOLYMATH_STATE_DIR: path.join(home, "caller-state"),
        OMNIPOLYMATH_PROFILE: "caller",
        OMNIPOLYMATH_CONFIG_PATH: path.join(home, "caller.json"),
      };
      for (const environment of [undefined, {}]) {
        const merged = mergeGatewayServiceEnv(caller, {
          programArguments: ["node", "omnipolymath.mjs", "gateway"],
          environment,
        });
        expect(resolveStateDir(merged)).toBe(path.join(home, ".omnipolymath"));
        expect(merged.OMNIPOLYMATH_CONFIG_PATH).toBeUndefined();
      }
    }),
);
const executable = "omnipolymath.exe|gateway";
const node = "node.exe|--import|bootstrap.mjs|omnipolymath.mjs";
const configPath = (dir: string) => path.join(dir, "omnipolymath.json");
type Environment = GatewayServiceCommandConfig["environment"];
const profileCases: Array<[string, Environment?, string?, ("argv" | "environment" | "default")?]> =
  [
    [`${node}|--profile=ops|gateway`, saved, "ops", "argv"],
    ["omnipolymath.exe|--dev|gateway", saved, "dev", "argv"],
    ["omnipolymath.exe|gateway|--dev", { omnipolymath_profile: "saved" }, "saved", "environment"],
    [executable, undefined, "default", "default"],
    [executable, { OMNIPOLYMATH_PROFILE: "Default" }, "default", "environment"],
    [""],
    ["node.exe|"],
    ["node.exe|--unknown-runtime-flag|omnipolymath.mjs|gateway"],
    ["omnipolymath.exe|--profile|bad profile|gateway"],
    ["omnipolymath.exe|--profile=rescue|gateway", { OMNIPOLYMATH_PROFILE: "bad profile" }],
  ];
it.each(profileCases)(
  "resolves Windows service profile: %s without rewriting command evidence",
  (argv, environment, profile, source) => {
    const command = { programArguments: argv ? argv.split("|") : [], environment };
    const captured = structuredClone(command);

    expect(resolveWindowsServiceCommandProfile(command)).toEqual(
      profile === undefined ? { kind: "unavailable" } : { kind: "resolved", profile, source },
    );
    expect(command).toEqual(captured);
  },
);
it.each([
  { platform: "win32", lowercase: false, direct: false },
  { platform: "win32", lowercase: false, direct: true },
  { platform: "win32", lowercase: true, direct: false },
  { platform: "linux", lowercase: false, direct: false },
] as const)(
  "projects argv profile on $platform with lowercase=$lowercase direct=$direct without redirecting native service identity",
  ({ platform, lowercase, direct }) => {
    withMockedPlatform(platform, () => {
      const home = path.resolve("service-profile-fixture");
      const savedDir = path.join(home, ".omnipolymath-saved");
      const rescueDir = path.join(home, ".omnipolymath-rescue");
      const serviceIdentity = {
        OMNIPOLYMATH_LAUNCHD_LABEL: "caller-agent",
        OMNIPOLYMATH_SYSTEMD_UNIT: "caller-unit.service",
        DBUS_SESSION_BUS_ADDRESS: "unix:path=/caller-bus",
        USER: "caller",
      };
      const identity = direct ? {} : serviceIdentity;
      const caller = {
        HOME: home,
        OMNIPOLYMATH_WINDOWS_TASK_NAME: "Services\\Selected",
        ...identity,
      };
      const command: GatewayServiceCommandConfig = direct
        ? { programArguments: ["omnipolymath.exe", "--profile=rescue", "gateway"] }
        : {
            programArguments: `${node}|--profile|rescue|gateway`.split("|"),
            environment: {
              OMNIPOLYMATH_PROFILE: "saved",
              OMNIPOLYMATH_STATE_DIR: savedDir,
              OMNIPOLYMATH_CONFIG_PATH: configPath(savedDir),
              OMNIPOLYMATH_WINDOWS_TASK_NAME: "Omnipolymath Gateway (saved)",
              OMNIPOLYMATH_LAUNCHD_LABEL: "ai.omnipolymath.saved",
              OMNIPOLYMATH_SYSTEMD_UNIT: "omnipolymath-gateway-saved.service",
              OMNIPOLYMATH_SERVICE_MARKER: "omnipolymath",
              OMNIPOLYMATH_SERVICE_KIND: "gateway",
              DBUS_SESSION_BUS_ADDRESS: "unix:path=/payload-bus",
              USER: "payload",
            },
          };
      const lower = (env: NonNullable<GatewayServiceCommandConfig["environment"]>) =>
        Object.fromEntries(Object.entries(env).map(([key, value]) => [key.toLowerCase(), value]));
      const baseEnv = lowercase ? lower(caller) : caller;
      if (lowercase) {
        command.environment = lower(command.environment!);
      }
      const captured = structuredClone({ baseEnv, command });

      const merged = mergeGatewayServiceEnv(baseEnv, command);

      const windows = platform === "win32";
      const expectedConfig = direct
        ? configPath(rescueDir)
        : windows
          ? undefined
          : configPath(savedDir);
      expect(merged.OMNIPOLYMATH_CONFIG_PATH).toBe(expectedConfig);
      expect(merged).toMatchObject({
        OMNIPOLYMATH_PROFILE: windows ? "rescue" : "saved",
        OMNIPOLYMATH_STATE_DIR: windows ? rescueDir : savedDir,
        OMNIPOLYMATH_WINDOWS_TASK_NAME: "Services\\Selected",
        ...identity,
      });
      expect({ baseEnv, command }).toEqual(captured);
    });
  },
);
