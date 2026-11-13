// Dotted providers cannot collide with Tailscale's email-ish, non-domain provider suffixes.
export const omnipolymathIdProfileProvider = "omnipolymath.id";

/** Authenticated OCID account key plus optional, non-authorizing display metadata. */
export type OmnipolymathIdUserProfileInput = {
  accountId: string;
  name?: string | null;
  email?: string | null;
};

/** Canonical profile references and presentation fields; never membership or role proof. */
export type OmnipolymathIdUserProfiles = Record<
  string,
  { id: string; displayName: string | null; email: string | null }
>;

/** Provider-scoped display data, not a verified-email or authorization binding. */
export type OmnipolymathIdProfileDisplayMetadata = {
  kind: "omnipolymath-id-display";
  email: string | null;
};
