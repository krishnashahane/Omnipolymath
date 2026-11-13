// Static scanner fixtures; never executed.
declare const inheritedEnv: Record<string, string>;
declare function resolveEnvironmentValue(env: Record<string, string>, key: string): string;
declare function sanitizeHostExecEnv(input: unknown): unknown;
declare function sanitizeSystemRunEnvOverrides(input: unknown): unknown;

const inheritedValues = {
  // ok: omnipolymath-dangerous-host-env-override-pivots
  git: resolveEnvironmentValue(inheritedEnv, "GIT_CONFIG_PARAMETERS"),
  // ok: omnipolymath-dangerous-host-env-override-pivots
  ssh: resolveEnvironmentValue(inheritedEnv, "GIT_SSH_COMMAND"),
};

const directOverrides = {
  // ruleid: omnipolymath-dangerous-host-env-override-pivots
  ["GIT_CONFIG_PARAMETERS"]: "untrusted",
  // ruleid: omnipolymath-dangerous-host-env-override-pivots
  ["GIT_SSH_COMMAND"]: "untrusted",
};

const copiedOverride = {
  // ruleid: omnipolymath-dangerous-host-env-override-pivots
  ["GIT_CONFIG_PARAMETERS"]: resolveEnvironmentValue(inheritedEnv, "GIT_CONFIG_PARAMETERS"),
};

// ruleid: omnipolymath-dangerous-host-env-override-pivots
sanitizeHostExecEnv({ overrides: { GIT_CONFIG_PARAMETERS: "untrusted" } });
// ruleid: omnipolymath-dangerous-host-env-override-pivots
sanitizeSystemRunEnvOverrides({ overrides: { GIT_SSH_COMMAND: "untrusted" } });

// ruleid: omnipolymath-dangerous-host-env-override-pivots
sanitizeHostExecEnv({
  overrides: {
    GIT_CONFIG_PARAMETERS: resolveEnvironmentValue(inheritedEnv, "GIT_CONFIG_PARAMETERS"),
  },
});

export { inheritedValues, directOverrides, copiedOverride };
