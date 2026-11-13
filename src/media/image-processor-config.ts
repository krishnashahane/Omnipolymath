import { createRastermill, type ImageExecutionMode } from "rastermill";
import { resolveSystemBin } from "../infra/resolve-system-bin.js";
import { resolvePreferredOmnipolymathTmpDir } from "../infra/tmp-omnipolymath-dir.js";

/** Shared input/output pixel cap for Rastermill-backed image operations. */
export const MAX_IMAGE_INPUT_PIXELS = 25_000_000;

export type ImageProcessorPixelLimits = { inputPixels: number; outputPixels: number };

export function createLocalImageProcessor(
  execution: ImageExecutionMode,
  limits: ImageProcessorPixelLimits = {
    inputPixels: MAX_IMAGE_INPUT_PIXELS,
    outputPixels: MAX_IMAGE_INPUT_PIXELS,
  },
) {
  return createRastermill({
    execution,
    limits,
    temp: {
      rootDir: resolvePreferredOmnipolymathTmpDir(),
      prefix: "omnipolymath-img-",
    },
    commandResolver: (command) =>
      resolveSystemBin(command, { trust: command === "powershell" ? "strict" : "standard" }),
  });
}
