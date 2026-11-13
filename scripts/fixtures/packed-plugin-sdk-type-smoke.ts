// Packed Plugin Sdk Type Smoke script supports Omnipolymath repository automation.
import { defineToolPlugin } from "omnipolymath/plugin-sdk/tool-plugin";
import "./packed-plugin-sdk-setup-consumer.js";
type PublicPluginSdkModules = [
  typeof import("omnipolymath/plugin-sdk/core"),
  typeof import("omnipolymath/plugin-sdk/channel-entry-contract"),
  typeof import("omnipolymath/plugin-sdk/config-contracts"),
  typeof import("omnipolymath/plugin-sdk/plugin-entry"),
  typeof import("omnipolymath/plugin-sdk/runtime-env"),
  typeof import("omnipolymath/plugin-sdk/tool-plugin"),
];

const resolvedModules = null as unknown as PublicPluginSdkModules;
void resolvedModules;
void defineToolPlugin;
