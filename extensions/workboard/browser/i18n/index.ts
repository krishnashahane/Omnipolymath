import { translateControlUiMessage } from "omnipolymath/plugin-sdk/control-ui";
import { workboardLocale } from "../host.ts";
import { messages } from "./locales.ts";

export function t(key: string, params?: Record<string, string>): string {
  return translateControlUiMessage(messages, workboardLocale(), key, params);
}
