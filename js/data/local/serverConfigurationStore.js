import {
  AVATAR_PUBLIC_BASE_URL,
  SUPABASE_ANON_KEY,
  SUPABASE_FALLBACK_URL,
  SUPABASE_URL,
  TV_LOGIN_WEB_BASE_URL
} from "../../config.js";
import { createServerConfiguration } from "../../core/server/serverConfiguration.js";

export const SERVER_CONFIGURATION_KEY = "nuvioServerConfigurationV1";
let activeConfiguration = null;

function officialConfiguration() {
  return createServerConfiguration({
    backendUrl: SUPABASE_URL,
    publishableKey: SUPABASE_ANON_KEY,
    capabilities: { emailPasswordAuth: false, tvLogin: true },
    isCustom: false,
    fallbackBackendUrl: SUPABASE_FALLBACK_URL,
    tvLoginWebBaseUrl: TV_LOGIN_WEB_BASE_URL,
    avatarPublicBaseUrl: AVATAR_PUBLIC_BASE_URL
  });
}

function validCustomConfiguration(value) {
  if (!value || typeof value !== "object" || value.isCustom !== true) return null;
  return createServerConfiguration({ ...value, isCustom: true });
}

function storageOrDefault(storage) {
  return storage || globalThis.localStorage;
}

export const ServerConfigurationStore = {
  getActive(storage) {
    if (!storage && activeConfiguration) return activeConfiguration;
    try {
      const raw = storageOrDefault(storage)?.getItem?.(SERVER_CONFIGURATION_KEY);
      const configuration = raw
        ? validCustomConfiguration(JSON.parse(raw)) || officialConfiguration()
        : officialConfiguration();
      if (!storage) activeConfiguration = configuration;
      return configuration;
    } catch (error) {
      console.warn("[serverConfiguration] Failed to load custom server", error);
      const configuration = officialConfiguration();
      if (!storage) activeConfiguration = configuration;
      return configuration;
    }
  },

  saveCustom(configuration, storage) {
    const normalized = validCustomConfiguration(configuration);
    if (!normalized) return false;
    try {
      const target = storageOrDefault(storage);
      if (!target?.setItem || !target?.getItem) return false;
      target.setItem(SERVER_CONFIGURATION_KEY, JSON.stringify(normalized));
      const saved = target.getItem(SERVER_CONFIGURATION_KEY) !== null;
      if (saved && !storage) activeConfiguration = normalized;
      return saved;
    } catch (error) {
      console.warn("[serverConfiguration] Failed to save custom server", error);
      return false;
    }
  },

  useOfficial(storage) {
    try {
      const target = storageOrDefault(storage);
      if (!target?.removeItem || !target?.getItem) return false;
      target.removeItem(SERVER_CONFIGURATION_KEY);
      const removed = target.getItem(SERVER_CONFIGURATION_KEY) == null;
      if (removed && !storage) activeConfiguration = officialConfiguration();
      return removed;
    } catch (error) {
      console.warn("[serverConfiguration] Failed to restore official server", error);
      return false;
    }
  }
};
