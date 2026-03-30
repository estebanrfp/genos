let resolveAutoDefault = function (providerId) {
    const id = normalizeChannelId(providerId);
    if (!id) {
      return false;
    }
    if (id === "discord" || id === "telegram") {
      return true;
    }
    if (id === "slack") {
      return false;
    }
    return false;
  },
  resolveNativeCommandSetting = function (params) {
    const { providerId, providerSetting, globalSetting } = params;
    const setting = providerSetting === undefined ? globalSetting : providerSetting;
    if (setting === true) {
      return true;
    }
    if (setting === false) {
      return false;
    }
    return resolveAutoDefault(providerId);
  };
import { normalizeChannelId } from "../channels/plugins/index.js";
export function resolveNativeSkillsEnabled(params) {
  return resolveNativeCommandSetting(params);
}
export function resolveNativeCommandsEnabled(params) {
  return resolveNativeCommandSetting(params);
}
export function isNativeCommandsExplicitlyDisabled(params) {
  const { providerSetting, globalSetting } = params;
  if (providerSetting === false) {
    return true;
  }
  if (providerSetting === undefined) {
    return globalSetting === false;
  }
  return false;
}
