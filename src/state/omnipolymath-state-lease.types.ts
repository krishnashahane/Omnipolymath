export type OmnipolymathStateLeaseIdentity = { scope: string; key: string; owner: string };
export type OmnipolymathStateLeaseAcquisition =
  | { kind: "acquired"; expiresAt: number }
  | { kind: "held"; holder: { owner: string; epoch: number; expiresAt: number | null } };
