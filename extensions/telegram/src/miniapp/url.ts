import {
  type OmnipolymathConfig,
  resolveGatewayPublicOrigin,
} from "omnipolymath/plugin-sdk/config-contracts";
import {
  resolveTailnetHostWithRunner,
  type TailscaleStatusCommandRunner,
} from "omnipolymath/plugin-sdk/core";
import { runCommandWithTimeout } from "omnipolymath/plugin-sdk/process-runtime";
import { normalizeControlUiBasePath } from "../control-ui-base-path.js";

export const TELEGRAM_MINIAPP_PATH_PREFIX = "/__omnipolymath_tg_miniapp/";
export const TELEGRAM_MINIAPP_URL_ERROR =
  "Mini App needs an HTTPS gateway URL. Configure an allowed HTTPS `gateway.publicOrigin` or Tailscale Serve/Funnel, then retry /controlui.";

export async function resolveTelegramMiniAppUrls(params: {
  cfg: OmnipolymathConfig;
  runCommand?: TailscaleStatusCommandRunner;
}) {
  const publicOrigin = resolveGatewayPublicOrigin(params.cfg);
  const allowedOrigins = params.cfg.gateway?.controlUi?.allowedOrigins;
  let origin =
    publicOrigin?.startsWith("https://") &&
    (allowedOrigins === undefined ||
      allowedOrigins.some((allowed) =>
        ["*", publicOrigin.toLowerCase()].includes(allowed.trim().toLowerCase()),
      ))
      ? publicOrigin
      : undefined;
  if (!origin) {
    const mode = params.cfg.gateway?.tailscale?.mode;
    const host =
      (mode === "serve" || mode === "funnel") &&
      (await resolveTailnetHostWithRunner(params.runCommand ?? runCommandWithTimeout));
    if (!host) {
      throw new Error(TELEGRAM_MINIAPP_URL_ERROR);
    }
    origin = `https://${host}`;
  }

  const controlUiPath = normalizeControlUiBasePath(
    params.cfg.gateway?.controlUi?.basePath?.trim() ?? "",
    "all",
  );
  return {
    pageUrl: `${origin}${TELEGRAM_MINIAPP_PATH_PREFIX}`,
    controlUiUrl: `${origin}${controlUiPath}`,
    // The Control UI serves its WebSocket endpoint under the same base path as
    // the HTTP app (ui/src/app/settings.ts deriveDefaultGatewayUrl); a bare
    // host URL breaks gateway.controlUi.basePath installs.
    gatewayUrl: `${origin.replace(/^https:/, "wss:")}${controlUiPath}`,
  };
}
