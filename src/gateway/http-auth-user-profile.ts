import type { IncomingMessage, ServerResponse } from "node:http";
import { isDeepStrictEqual } from "node:util";
import { normalizeOptionalString } from "@omnipolymath/normalization-core/string-coerce";
import { getRuntimeConfig } from "../config/io.js";
import type { GatewayOperatorRoleDefinition } from "../config/types.gateway.js";
import type { OmnipolymathConfig } from "../config/types.omnipolymath.js";
import { resolveHostAccountName } from "../infra/host-account-name.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { intersectOperatorScopes } from "../shared/operator-scope-compat.js";
import { prepareUserProfileRoleAuthority } from "../state/user-channel-identity-operations.js";
import {
  captureResidentUserProfileAccess,
  prepareUserProfileCatalog,
  projectUserProfileDisplay,
} from "../state/user-profile-list.js";
import {
  ensureCanonicalGatewayOwnerProfile,
  ensureCanonicalUserProfileForEmail,
  ensureCanonicalDelegatedUserProfile,
  ensureCanonicalUserProfileForOmnipolymathIdIdentity,
  ensureCanonicalUserProfileForTailscaleIdentity,
} from "../state/user-profile-writes.js";
import type { GatewayAuthResult } from "./auth.js";
import { shouldUseGatewayOwnerProfile } from "./gateway-owner-profile.js";
import { createAuthenticatedGitHubIdentitySync } from "./github-user-identity.js";
import {
  getRemoteControlUiIngressContext,
  assertRemoteControlUiIngressCurrent,
} from "./ingress-attribution.js";
import {
  isOmnipolymathIdTunnelPrincipalCurrent,
  omnipolymathIdTunnelRolePolicy,
  type OmnipolymathIdTunnelPrincipal,
} from "./omnipolymath-id/tunnel-principal.js";
import {
  GatewayOperatorAccessDeniedError,
  hasGatewayOperatorAccessPolicies,
  resolveGatewayOperatorAccessAuthority,
} from "./operator-access-policy.js";
import type { GatewayOperatorAccessAuthority } from "./operator-access-policy.types.js";
import { resolveOperatorRolePolicyForAssignment } from "./operator-role-policy.js";
import { resolveBrowserOriginPolicy } from "./origin-check.js";
import type { GatewayClient, GatewayOperatorRoleActor } from "./server-methods/shared-types.js";
import { isGatewayDelegationCurrent } from "./trusted-proxy-delegation.js";
import { formatForLog } from "./ws-log.js";

const profileLog = createSubsystemLogger("gateway/user-profiles");

export type AuthenticatedHttpUserProfile = {
  authenticatedUserProfile?: GatewayClient["authenticatedUserProfile"];
  /** Original authenticated device authority, retained across synthetic execution clients. */
  omnipolymathIdPrincipal?: OmnipolymathIdTunnelPrincipal;
  preparedSessionProfile?: GatewayClient["preparedSessionProfile"];
  operatorRolePolicy?: GatewayOperatorRoleDefinition;
  operatorAccessAuthority?: GatewayOperatorAccessAuthority | null;
  operatorRoleActor?: GatewayOperatorRoleActor;
  hasCurrentProfileAuthority?: () => boolean;
};

type HttpUserProfileAuthResult =
  | { ok: true; profile: AuthenticatedHttpUserProfile }
  | { ok: false; authResult: GatewayAuthResult };

function failedHttpProfileAuthentication(error?: unknown): HttpUserProfileAuthResult {
  return {
    ok: false,
    authResult: {
      ok: false,
      reason:
        error instanceof GatewayOperatorAccessDeniedError
          ? "operator_access_denied"
          : "user_profile_unavailable",
    },
  };
}

// An Omnipolymath ID tunnel device is capped by its membership role on every HTTP
// surface, and its request keeps authority only while that membership is
// unchanged: a removal or role change fails every later authority check.
function withOmnipolymathIdPrincipal(
  profile: AuthenticatedHttpUserProfile,
  principal: OmnipolymathIdTunnelPrincipal,
): AuthenticatedHttpUserProfile {
  const rolePolicy = omnipolymathIdTunnelRolePolicy(principal);
  const hasCurrentProfileAuthority = profile.hasCurrentProfileAuthority;
  return {
    ...profile,
    omnipolymathIdPrincipal: principal,
    ...(rolePolicy ? { operatorRolePolicy: rolePolicy } : {}),
    hasCurrentProfileAuthority: () =>
      hasCurrentProfileAuthority?.() !== false && isOmnipolymathIdTunnelPrincipalCurrent(principal),
  };
}

export async function checkAuthenticatedHttpUserProfile(
  params: Parameters<typeof resolveAuthenticatedHttpUserProfile>[0],
): Promise<HttpUserProfileAuthResult> {
  try {
    const profile = await resolveAuthenticatedHttpUserProfile(params);
    const principal =
      params.authResult.method === "trusted-proxy" ? params.authResult.omnipolymathId : undefined;
    return { ok: true, profile: principal ? withOmnipolymathIdPrincipal(profile, principal) : profile };
  } catch (error) {
    return failedHttpProfileAuthentication(error);
  }
}

/** A signed cookie retains one exact profile reference; current policy still governs its admission. */
export function checkHttpCookieUserProfile(
  cfg: OmnipolymathConfig,
  profileId: string | undefined,
): HttpUserProfileAuthResult {
  if (!profileId && (cfg.gateway?.roles || hasGatewayOperatorAccessPolicies(cfg))) {
    return failedHttpProfileAuthentication();
  }
  // A signed viewer still narrows session sharing when named roles are disabled.
  if (!profileId) {
    return { ok: true, profile: {} };
  }
  try {
    return { ok: true, profile: resolveHttpProfile(profileId, cfg) };
  } catch (error) {
    return failedHttpProfileAuthentication(error);
  }
}

/** Response disclosure retains the existing profile owner through its last synchronous check. */
export async function prepareHttpUserProfileCatalog(res: ServerResponse): Promise<boolean> {
  if (res.writableEnded || res.destroyed) {
    return false;
  }
  let catalog: Awaited<ReturnType<typeof prepareUserProfileCatalog>>;
  try {
    catalog = await prepareUserProfileCatalog();
  } catch {
    return false;
  }
  const release = () => {
    res.off("finish", release);
    res.off("close", release);
    catalog.release();
  };
  if (res.writableEnded || res.destroyed) {
    release();
    return false;
  }
  res.once("finish", release);
  res.once("close", release);
  return true;
}

export function usesSharedSecretGatewayMethod(
  method: GatewayAuthResult["method"] | undefined,
): boolean {
  return method === "token" || method === "password";
}

export async function resolveAuthenticatedHttpUserProfile(params: {
  authResult: GatewayAuthResult;
  cfg: OmnipolymathConfig;
  getRuntimeConfig?: () => OmnipolymathConfig;
  req: IncomingMessage;
  res?: ServerResponse;
}): Promise<AuthenticatedHttpUserProfile> {
  const ingress = getRemoteControlUiIngressContext(params.req);
  if (ingress) {
    assertRemoteControlUiIngressCurrent(ingress);
    const principal = ingress.resolvePrincipal();
    return {
      authenticatedUserProfile: principal.authenticatedUserProfile,
      preparedSessionProfile: principal.preparedSessionProfile,
      operatorRolePolicy: principal.operatorRolePolicy,
      operatorRoleActor: principal.operatorRoleActor,
      operatorAccessAuthority: principal.operatorAccessAuthority,
    };
  }
  const readAdmissionPolicy = (cfg: OmnipolymathConfig) => ({
    // HTTP admission never consumes WebSocket identity grants.
    auth: { ...cfg.gateway?.auth, identityScopes: undefined },
    roles: cfg.gateway?.roles,
    trustedProxies: cfg.gateway?.trustedProxies,
    allowRealIpFallback: cfg.gateway?.allowRealIpFallback,
    browserOrigin: resolveBrowserOriginPolicy({ req: params.req, cfg }),
  });
  const admissionPolicy = structuredClone(readAdmissionPolicy(params.cfg));
  const assertCurrent = () => {
    if (
      (params.authResult.delegation &&
        !isGatewayDelegationCurrent(
          params.authResult.delegation,
          params.getRuntimeConfig?.() ?? getRuntimeConfig(),
        )) ||
      params.req.aborted ||
      params.req.socket?.destroyed ||
      params.res?.destroyed ||
      params.res?.writableEnded ||
      !isDeepStrictEqual(
        admissionPolicy,
        readAdmissionPolicy(params.getRuntimeConfig?.() ?? getRuntimeConfig()),
      )
    ) {
      throw new Error("HTTP profile acquisition authority expired");
    }
  };
  assertCurrent();
  const options = { assertCurrent };
  const authenticatedUserId = normalizeOptionalString(params.authResult.user);
  const rolesConfigured = Boolean(params.cfg.gateway?.roles);
  const accessPoliciesConfigured = hasGatewayOperatorAccessPolicies(params.cfg);
  if (!authenticatedUserId) {
    if (
      shouldUseGatewayOwnerProfile({
        role: "operator",
        authenticatedUserId,
        authMethod: params.authResult.method,
        rolesConfigured,
        omnipolymathIdOwner:
          params.authResult.method === "trusted-proxy" &&
          params.authResult.omnipolymathId?.kind === "owner",
      })
    ) {
      try {
        const displayName = await resolveHostAccountName();
        assertCurrent();
        const profile = await ensureCanonicalGatewayOwnerProfile(displayName, options);
        // Shared-secret operators retain their existing authority, regardless of profile roles.
        return await prepareHttpProfile(profile.id, profile.updatedAt, assertCurrent);
      } catch (error) {
        assertCurrent();
        profileLog.warn(`owner profile resolution failed: ${formatForLog(error)}`);
        return {};
      }
    }
    throw new Error("operator role policies require a verified durable user profile");
  }
  try {
    const syncGitHubIdentity = createAuthenticatedGitHubIdentitySync({
      authResult: params.authResult,
      authConfig: params.cfg.gateway?.auth,
      config: params.cfg,
      requestHeaders: params.req.headers,
      assertCurrent,
    });
    const member =
      params.authResult.method === "trusted-proxy" &&
      params.authResult.omnipolymathId?.kind === "member"
        ? params.authResult.omnipolymathId
        : undefined;
    const profile = params.authResult.delegation
      ? await ensureCanonicalDelegatedUserProfile(params.authResult.delegation.identity, options)
      : member
        ? await ensureCanonicalUserProfileForOmnipolymathIdIdentity(
            { accountId: member.accountId },
            options,
          )
        : syncGitHubIdentity
          ? await syncGitHubIdentity()
          : params.authResult.tailscaleIdentity
            ? await ensureCanonicalUserProfileForTailscaleIdentity(
                params.authResult.tailscaleIdentity,
                options,
              )
            : await ensureCanonicalUserProfileForEmail(authenticatedUserId, options);
    const profileId = "profileId" in profile ? profile.profileId : profile.id;
    const prepared = await prepareHttpProfile(
      profileId,
      profile.updatedAt,
      assertCurrent,
      usesSharedSecretGatewayMethod(params.authResult.method) ? undefined : params.cfg,
    );
    const delegation = params.authResult.delegation;
    if (delegation) {
      const profileCurrent = prepared.hasCurrentProfileAuthority;
      return {
        ...prepared,
        hasCurrentProfileAuthority: () =>
          profileCurrent?.() !== false &&
          isGatewayDelegationCurrent(delegation, params.getRuntimeConfig?.() ?? getRuntimeConfig()),
      };
    }
    return prepared;
  } catch (error) {
    assertCurrent();
    // Attribution enriches authenticated requests; configured role/access policies
    // make durable profile resolution a prerequisite for authorization.
    if (params.authResult.delegation || rolesConfigured || accessPoliciesConfigured) {
      throw error;
    }
    return {};
  }
}

async function prepareHttpProfile(
  profileId: string,
  updatedAt: number,
  assertCurrent: () => void,
  cfg?: OmnipolymathConfig,
) {
  assertCurrent();
  if (cfg && hasGatewayOperatorAccessPolicies(cfg)) {
    (await prepareUserProfileCatalog()).release();
    assertCurrent();
  }
  const authority = await prepareUserProfileRoleAuthority(profileId);
  assertCurrent();
  if (!authority?.isCurrent()) {
    throw new Error("HTTP profile authority changed during acquisition");
  }
  const display = authority.display;
  const operatorRolePolicy = cfg
    ? resolveOperatorRolePolicyForAssignment(
        display.id,
        authority.role,
        cfg,
        authority.githubLogin ?? null,
      )
    : undefined;
  const operatorAccessAuthority = cfg
    ? resolveGatewayOperatorAccessAuthority(profileId, cfg)
    : undefined;
  assertCurrent();
  if (!authority.isCurrent()) {
    throw new Error("HTTP profile authority changed during acquisition");
  }
  return {
    ...projectHttpProfile(display, updatedAt, operatorRolePolicy, operatorAccessAuthority),
    // Identity-derived HTTP authority must not outlive the profile binding that admitted it.
    // Shared-secret authority remains independent of owner-profile attribution.
    ...(cfg ? { hasCurrentProfileAuthority: authority.isCurrent } : {}),
    ...(cfg
      ? {
          preparedSessionProfile: {
            profileId: authority.profileId,
            aliases: new Set(authority.aliases),
            role: authority.role,
            githubLogin: authority.githubLogin,
          },
        }
      : {}),
  };
}

/** Cookie and media disclosure retain their existing synchronous final policy check. */
export function resolveHttpProfile(profileId: string, cfg?: OmnipolymathConfig) {
  const profile = captureResidentUserProfileAccess(profileId).assertCurrent();
  const display = projectUserProfileDisplay(profile);
  const operatorRolePolicy = cfg
    ? resolveOperatorRolePolicyForAssignment(
        profile.id,
        profile.role ?? null,
        cfg,
        profile.githubLogin ?? null,
      )
    : undefined;
  const operatorAccessAuthority = cfg
    ? resolveGatewayOperatorAccessAuthority(profileId, cfg)
    : undefined;
  return projectHttpProfile(
    display,
    profile.updated_at,
    operatorRolePolicy,
    operatorAccessAuthority,
  );
}

function projectHttpProfile(
  display: ReturnType<typeof projectUserProfileDisplay>,
  updatedAt: number,
  operatorRolePolicy: GatewayOperatorRoleDefinition | undefined,
  operatorAccessAuthority: GatewayOperatorAccessAuthority | null | undefined,
) {
  return {
    authenticatedUserProfile: {
      profileId: display.id,
      displayName: display.displayName,
      avatarRevision: display.avatarRevision,
      hasAvatar: display.hasAvatar,
      updatedAt,
    },
    ...(operatorRolePolicy ? { operatorRolePolicy } : {}),
    ...(operatorAccessAuthority !== undefined ? { operatorAccessAuthority } : {}),
  };
}

export function applyHttpOperatorRoleScopeCeiling(
  scopes: string[],
  auth: Pick<AuthenticatedHttpUserProfile, "operatorRolePolicy"> | undefined,
): string[] {
  const allowedScopes = auth?.operatorRolePolicy?.scopes;
  return allowedScopes ? intersectOperatorScopes(scopes, allowedScopes) : scopes;
}
