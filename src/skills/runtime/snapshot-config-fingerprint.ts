import { stableStringify } from "@omnipolymath/normalization-core";
import { redactConfigObject } from "../../config/redact-snapshot.js";
import type { OmnipolymathConfig } from "../../config/types.omnipolymath.js";
import { sha256Hex } from "../../infra/crypto-digest.js";

let configFingerprints = new WeakMap<OmnipolymathConfig, string>();

export function fingerprintSkillSnapshotConfig(config: OmnipolymathConfig): string {
  const cached = configFingerprints.get(config);
  if (cached) {
    return cached;
  }
  const fingerprint = sha256Hex(stableStringify(redactConfigObject(config)));
  configFingerprints.set(config, fingerprint);
  return fingerprint;
}

export function resetSkillSnapshotConfigFingerprintCache(): void {
  configFingerprints = new WeakMap();
}
