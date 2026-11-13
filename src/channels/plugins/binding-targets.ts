import type { OmnipolymathConfig } from "../../config/types.omnipolymath.js";
import { formatErrorMessage } from "../../infra/errors.js";
import type {
  ConfiguredBindingResolution,
  StatefulBindingTargetResetResult,
} from "./binding-types.js";

export async function ensureConfiguredBindingTargetReady(params: {
  assertActive?: () => void;
  cfg: OmnipolymathConfig;
  bindingResolution: ConfiguredBindingResolution | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!params.bindingResolution) {
    return { ok: true };
  }
  const driverId = params.bindingResolution.statefulTarget.driverId;
  if (driverId.trim() !== "acp") {
    return {
      ok: false,
      error: `Configured binding target driver unavailable: ${driverId}`,
    };
  }
  const { ensureConfiguredAcpBindingTargetReady } = await import("./acp-stateful-target-driver.js");
  try {
    params.assertActive?.();
  } catch (error) {
    return { ok: false, error: formatErrorMessage(error) };
  }
  return await ensureConfiguredAcpBindingTargetReady({
    ...(params.assertActive ? { assertActive: params.assertActive } : {}),
    cfg: params.cfg,
    bindingResolution: params.bindingResolution,
  });
}

export async function resetConfiguredBindingTargetInPlace(params: {
  cfg: OmnipolymathConfig;
  sessionKey: string;
  reason: "new" | "reset";
  commandSource?: string;
}): Promise<StatefulBindingTargetResetResult> {
  const { resolveAcpBindingTargetBySessionKey, resetConfiguredAcpBindingTargetInPlace } =
    await import("./acp-stateful-target-driver.js");
  const bindingTarget = await resolveAcpBindingTargetBySessionKey({
    cfg: params.cfg,
    sessionKey: params.sessionKey,
  });
  if (!bindingTarget) {
    return {
      ok: false,
      skipped: true,
    };
  }
  return await resetConfiguredAcpBindingTargetInPlace({
    ...params,
    bindingTarget,
  });
}
