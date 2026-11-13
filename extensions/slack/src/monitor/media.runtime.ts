import { createSubsystemLogger } from "omnipolymath/plugin-sdk/runtime-env";

export const slackMediaLog = createSubsystemLogger("gateway/channels/slack").child("media");
export { fetchWithRuntimeDispatcher } from "omnipolymath/plugin-sdk/runtime-fetch";
export type { FetchLike } from "omnipolymath/plugin-sdk/media-runtime";
export { captureChannelReadAuthority } from "omnipolymath/plugin-sdk/fetch-runtime";
export { saveRemoteMedia, unlinkIfExists } from "omnipolymath/plugin-sdk/media-runtime";
